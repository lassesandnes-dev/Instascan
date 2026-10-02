import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  computeStatistics,
  encodePointCloud,
  GEOMETRY_ENGINE_VERSION,
  parseXyz,
  XyzParseError,
} from "@massefelt/geometry";
import { AppError, DATA_SOURCES, detectFormat, NotFoundError, ValidationError, logger } from "@massefelt/shared";
import type { CurrentUser } from "../auth";
import { services } from "../context";
import { serverEnv } from "../env";
import { requireProject } from "./projects";

export const scanMetadataSchema = z.object({
  name: z.string().trim().max(200).optional(),
  source: z.enum(DATA_SOURCES).default("file-import"),
  acquisitionDate: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Invalid acquisition date" });
        return z.NEVER;
      }
      return d;
    }),
  crs: z.string().trim().max(128).optional().transform((v) => v || null),
  verticalDatum: z.string().trim().max(128).optional().transform((v) => v || null),
  units: z.enum(["m", "mm", "cm", "ft", "us-ft"]).default("m"),
});

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
}

const XYZ_IMPORT_METHOD = "xyz-ascii-import";

function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  return base.replace(/[^\w.\-() ]+/g, "_").slice(0, 200) || "upload";
}

/** ASCII point files must be text: reject NUL bytes and invalid UTF-8. */
function decodeTextFile(bytes: Uint8Array): string {
  const probe = bytes.subarray(0, Math.min(bytes.length, 65536));
  if (probe.includes(0)) throw new ValidationError("File looks binary; XYZ/CSV files must be plain text");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ValidationError("File is not valid UTF-8 text");
  }
}

/**
 * Import an XYZ/CSV point file.
 *
 * Steps: validate → store original verbatim → parse (data only, never
 * executed) → compute deterministic statistics → store web-optimized MFPC
 * buffer → persist Scan, ScanFile, Asset (with provenance), PointCloud and a
 * ProcessingJob record documenting the inline processing.
 *
 * XYZ import is light enough to run inline. Heavy pipelines (LAS/E57,
 * photogrammetry, meshing) are queued as ProcessingJobs for the worker.
 */
export async function importPointFile(user: CurrentUser, projectId: string, file: UploadedFile, rawMeta: unknown) {
  const env = serverEnv();
  await requireProject(user, projectId);
  const meta = scanMetadataSchema.parse(rawMeta);

  if (file.size === 0) throw new ValidationError("File is empty");
  if (file.size > env.UPLOAD_MAX_BYTES) {
    throw new AppError("file_too_large", `File exceeds the upload limit of ${Math.round(env.UPLOAD_MAX_BYTES / 1048576)} MiB`, 413);
  }
  const filename = sanitizeFilename(file.name);
  const format = detectFormat(filename);
  if (!format) throw new ValidationError(`Unsupported file type: ${filename}`);
  if (format.status !== "supported") {
    throw new AppError("format_planned", `${format.label} import is planned but not yet supported`, 415);
  }

  const { db, storage } = services();
  const log = logger.child({ op: "scan.import", projectId, userId: user.id });
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const text = decodeTextFile(file.bytes);

  const scan = await db.scan.create({
    data: {
      projectId,
      name: meta.name || filename.replace(/\.[^.]+$/, ""),
      source: meta.source,
      acquisitionDate: meta.acquisitionDate,
      crs: meta.crs,
      verticalDatum: meta.verticalDatum,
      units: meta.units,
      status: "PROCESSING",
      createdById: user.id,
    },
  });
  const job = await db.processingJob.create({
    data: {
      projectId,
      scanId: scan.id,
      type: "pointcloud.import.xyz",
      executor: "inline",
      status: "RUNNING",
      attempts: 1,
      startedAt: new Date(),
      engine: XYZ_IMPORT_METHOD,
      engineVersion: GEOMETRY_ENGINE_VERSION,
      input: { filename, sizeBytes: file.size, sha256 },
    },
  });

  const fileId = randomUUID();
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ".txt";
  const originalKey = `projects/${projectId}/scans/${scan.id}/original/${fileId}${ext}`;

  try {
    await storage.put(originalKey, file.bytes, "text/plain");
    const scanFile = await db.scanFile.create({
      data: {
        scanId: scan.id,
        originalFilename: filename,
        format: format.id,
        mimeType: file.type || null,
        sizeBytes: BigInt(file.size),
        sha256,
        storageKey: originalKey,
      },
    });

    const parsed = parseXyz(text, { maxPoints: env.UPLOAD_MAX_POINTS });
    const stats = computeStatistics(parsed.cloud);
    const encoded = encodePointCloud(parsed.cloud);
    const assetId = randomUUID();
    const bufferKey = `projects/${projectId}/scans/${scan.id}/assets/${assetId}.mfpc`;
    await storage.put(bufferKey, new Uint8Array(encoded.buffer), "application/octet-stream");

    const asset = await db.asset.create({
      data: {
        id: assetId,
        projectId,
        scanId: scan.id,
        kind: "POINT_CLOUD",
        name: scan.name,
        originalFilename: filename,
        source: meta.source,
        acquisitionDate: meta.acquisitionDate,
        crs: meta.crs,
        verticalDatum: meta.verticalDatum,
        processingMethod: XYZ_IMPORT_METHOD,
        processingVersion: GEOMETRY_ENGINE_VERSION,
        units: meta.units,
        sourceFileId: scanFile.id,
        storageKey: bufferKey,
        pointCloud: {
          create: {
            pointCount: stats.count,
            minX: stats.bbox.min.x,
            minY: stats.bbox.min.y,
            minZ: stats.bbox.min.z,
            maxX: stats.bbox.max.x,
            maxY: stats.bbox.max.y,
            maxZ: stats.bbox.max.z,
            originX: encoded.origin.x,
            originY: encoded.origin.y,
            originZ: encoded.origin.z,
            hasColor: stats.hasColor,
            hasIntensity: stats.hasIntensity,
            statistics: JSON.parse(JSON.stringify(stats)),
          },
        },
      },
    });

    const statusMessage = parsed.skippedLines ? `${parsed.skippedLines} malformed line(s) skipped` : null;
    await db.$transaction([
      db.scan.update({ where: { id: scan.id }, data: { status: "READY", statusMessage } }),
      db.processingJob.update({
        where: { id: job.id },
        data: {
          status: "SUCCEEDED",
          progress: 1,
          finishedAt: new Date(),
          output: {
            assetId: asset.id,
            pointCount: stats.count,
            skippedLines: parsed.skippedLines,
            warnings: parsed.warnings.map((w) => ({ line: w.line, message: w.message })),
            delimiter: parsed.delimiter,
            header: parsed.header,
          },
        },
      }),
    ]);
    log.info("point file imported", { scanId: scan.id, points: stats.count, skipped: parsed.skippedLines });
    return { scanId: scan.id, assetId: asset.id, pointCount: stats.count, skippedLines: parsed.skippedLines, warnings: parsed.warnings };
  } catch (err) {
    const message = err instanceof XyzParseError || err instanceof AppError ? err.message : "Processing failed";
    log.warn("point file import failed", { scanId: scan.id, err: err instanceof Error ? err.message : String(err) });
    await db.$transaction([
      db.scan.update({ where: { id: scan.id }, data: { status: "FAILED", statusMessage: message } }),
      db.processingJob.update({ where: { id: job.id }, data: { status: "FAILED", error: message, finishedAt: new Date() } }),
    ]);
    if (err instanceof XyzParseError) throw new AppError("parse_error", err.message, 422, { scanId: scan.id });
    throw err;
  }
}

export async function listScans(user: CurrentUser, projectId: string) {
  await requireProject(user, projectId);
  return services().data.listScans(projectId);
}

export async function getScanDetail(user: CurrentUser, scanId: string) {
  const { db, data } = services();
  const scan = await db.scan.findUnique({ where: { id: scanId }, select: { projectId: true } });
  if (!scan) throw new NotFoundError("Scan", scanId);
  await requireProject(user, scan.projectId);
  const detail = await data.getScan(scan.projectId, scanId);
  if (!detail) throw new NotFoundError("Scan", scanId);
  return detail;
}

/** Return the web-optimized point buffer for the scan's latest point-cloud asset. */
export async function getScanPointBuffer(user: CurrentUser, scanId: string): Promise<Uint8Array> {
  const { db, storage } = services();
  const scan = await db.scan.findUnique({ where: { id: scanId }, select: { projectId: true } });
  if (!scan) throw new NotFoundError("Scan", scanId);
  await requireProject(user, scan.projectId);
  const asset = await db.asset.findFirst({
    where: { scanId, kind: "POINT_CLOUD", storageKey: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (!asset?.storageKey) throw new NotFoundError("Point cloud for scan", scanId);
  return storage.get(asset.storageKey);
}

export async function deleteScan(user: CurrentUser, scanId: string) {
  const { db, storage } = services();
  const scan = await db.scan.findUnique({ where: { id: scanId }, include: { files: true, assets: true } });
  if (!scan) throw new NotFoundError("Scan", scanId);
  await requireProject(user, scan.projectId);
  await db.scan.delete({ where: { id: scanId } });
  const keys = [...scan.files.map((f) => f.storageKey), ...scan.assets.map((a) => a.storageKey)].filter((k): k is string => !!k);
  await Promise.allSettled(keys.map((k) => storage.delete(k)));
}
