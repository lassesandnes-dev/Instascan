import { z } from "zod";
import { GEOMETRY_ENGINE_VERSION, measureDistance, measureElevationDifference } from "@massefelt/geometry";
import { describeCrs, NotFoundError, ValidationError } from "@massefelt/shared";
import { ToolRegistry } from "./registry";
import type { ToolContext, ToolDefinition } from "./types";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id");
const coordinate = z.object({
  x: z.number().finite().describe("Easting / X in the scan's CRS"),
  y: z.number().finite().describe("Northing / Y in the scan's CRS"),
  z: z.number().finite().describe("Height / Z in the scan's vertical datum"),
});

function defineTool<S extends z.ZodType, R>(def: ToolDefinition<S, R>): ToolDefinition<S, R> {
  return def;
}

async function requireScan(ctx: ToolContext, scanId: string | undefined) {
  const resolved = scanId ?? ctx.selection.scanId;
  if (!resolved) throw new ValidationError("No scanId given and no scan is selected in the viewer");
  const scan = await ctx.data.getScan(ctx.projectId, resolved);
  if (!scan) throw new NotFoundError("Scan", resolved);
  return scan;
}

export const getProjectTool = defineTool({
  name: "getProject",
  description: "Get the current project's name, description, default CRS/vertical datum, units and counts.",
  inputSchema: z.object({}).strict(),
  readOnly: true,
  async execute(_input, ctx) {
    const project = await ctx.data.getProject(ctx.projectId);
    if (!project) throw new NotFoundError("Project", ctx.projectId);
    return { ...project, crsLabel: describeCrs(project.defaultCrs) };
  },
});

export const getSelectionTool = defineTool({
  name: "getSelection",
  description:
    "Get what the user currently has selected in the 3D viewer: the selected scan, selected measurement and selected objects (ids and names).",
  inputSchema: z.object({}).strict(),
  readOnly: true,
  async execute(_input, ctx) {
    const { scanId, measurementId, objectIds } = ctx.selection;
    const scan = scanId ? await ctx.data.getScan(ctx.projectId, scanId) : null;
    const measurement = measurementId ? await ctx.data.getMeasurement(ctx.projectId, measurementId) : null;
    return {
      selectedScan: scan ? { id: scan.id, name: scan.name } : null,
      selectedMeasurement: measurement ? { id: measurement.id, name: measurement.name, type: measurement.type } : null,
      selectedObjectIds: objectIds,
    };
  },
});

export const listScansTool = defineTool({
  name: "listScans",
  description:
    "List all scans (point clouds / terrain captures) in the current project with status, source, CRS, point count and original filename.",
  inputSchema: z.object({}).strict(),
  readOnly: true,
  async execute(_input, ctx) {
    const scans = await ctx.data.listScans(ctx.projectId);
    return { count: scans.length, scans };
  },
});

export const getScanMetadataTool = defineTool({
  name: "getScanMetadata",
  description:
    "Get full metadata and provenance for one scan: files, CRS, vertical datum, units, processing method/version, point count. Defaults to the selected scan.",
  inputSchema: z.object({ scanId: id.optional().describe("Scan id; omit to use the selected scan") }).strict(),
  readOnly: true,
  async execute({ scanId }, ctx) {
    const scan = await requireScan(ctx, scanId);
    const { pointCloud, ...rest } = scan;
    return {
      ...rest,
      crsLabel: describeCrs(scan.crs),
      pointCloud: pointCloud
        ? {
            assetId: pointCloud.assetId,
            pointCount: pointCloud.pointCount,
            hasColor: pointCloud.hasColor,
            hasIntensity: pointCloud.hasIntensity,
            provenance: pointCloud.provenance,
          }
        : null,
    };
  },
});

export const getBoundingBoxTool = defineTool({
  name: "getBoundingBox",
  description: "Get the axis-aligned bounding box (min/max X,Y,Z) and extent of a scan's point cloud in its native CRS.",
  inputSchema: z.object({ scanId: id.optional() }).strict(),
  readOnly: true,
  async execute({ scanId }, ctx) {
    const scan = await requireScan(ctx, scanId);
    if (!scan.pointCloud) throw new ValidationError(`Scan ${scan.id} has no processed point cloud (status ${scan.status})`);
    const { bbox } = scan.pointCloud;
    return {
      scanId: scan.id,
      bbox,
      extent: { x: bbox.max.x - bbox.min.x, y: bbox.max.y - bbox.min.y, z: bbox.max.z - bbox.min.z },
      crs: scan.crs,
      units: scan.units,
    };
  },
});

export const getStatisticsTool = defineTool({
  name: "getStatistics",
  description:
    "Get deterministic statistics of a scan's point cloud: point count, bbox, centroid, Z min/max/mean/std-dev and planar density.",
  inputSchema: z.object({ scanId: id.optional() }).strict(),
  readOnly: true,
  async execute({ scanId }, ctx) {
    const scan = await requireScan(ctx, scanId);
    if (!scan.pointCloud) throw new ValidationError(`Scan ${scan.id} has no processed point cloud (status ${scan.status})`);
    return { scanId: scan.id, crs: scan.crs, units: scan.units, statistics: scan.pointCloud.statistics };
  },
});

export const listMeasurementsTool = defineTool({
  name: "listMeasurements",
  description: "List saved measurements in the project (optionally for one scan) with their primary values.",
  inputSchema: z.object({ scanId: id.optional() }).strict(),
  readOnly: true,
  async execute({ scanId }, ctx) {
    const list = await ctx.data.listMeasurements(ctx.projectId, scanId ? { scanId } : undefined);
    return {
      count: list.length,
      measurements: list.map((m) => ({ id: m.id, name: m.name, type: m.type, value: m.value, units: m.units, scanId: m.scanId, createdAt: m.createdAt })),
    };
  },
});

export const getMeasurementTool = defineTool({
  name: "getMeasurement",
  description:
    "Get a saved measurement including its points, 3D distance, horizontal distance and dX/dY/dZ. Defaults to the measurement currently selected in the viewer.",
  inputSchema: z.object({ measurementId: id.optional().describe("Measurement id; omit to use the selected measurement") }).strict(),
  readOnly: true,
  async execute({ measurementId }, ctx) {
    const resolved = measurementId ?? ctx.selection.measurementId;
    if (!resolved) throw new ValidationError("No measurementId given and no measurement is selected");
    const m = await ctx.data.getMeasurement(ctx.projectId, resolved);
    if (!m) throw new NotFoundError("Measurement", resolved);
    return m;
  },
});

export const measureDistanceTool = defineTool({
  name: "measureDistance",
  description:
    "Compute the true 3D distance, horizontal distance, dX/dY/dZ and slope between two coordinates (same CRS). Does not save anything.",
  inputSchema: z.object({ from: coordinate, to: coordinate }).strict(),
  readOnly: true,
  async execute({ from, to }) {
    return { ...measureDistance(from, to), engineVersion: GEOMETRY_ENGINE_VERSION };
  },
});

export const measureElevationDifferenceTool = defineTool({
  name: "measureElevationDifference",
  description: "Compute the height difference (to.z − from.z) between two coordinates in the same vertical datum.",
  inputSchema: z.object({ from: coordinate, to: coordinate }).strict(),
  readOnly: true,
  async execute({ from, to }) {
    return { elevationDifference: measureElevationDifference(from, to), engineVersion: GEOMETRY_ENGINE_VERSION };
  },
});

export const MILESTONE_1_TOOLS = [
  getProjectTool,
  getSelectionTool,
  listScansTool,
  getScanMetadataTool,
  getBoundingBoxTool,
  getStatisticsTool,
  listMeasurementsTool,
  getMeasurementTool,
  measureDistanceTool,
  measureElevationDifferenceTool,
] as unknown as ToolDefinition[];

/**
 * Tools that are designed but NOT implemented. They are deliberately not
 * registered, so models cannot call them and receive fabricated results.
 */
export const PLANNED_TOOLS = [
  { name: "calculateVolume", purpose: "Cut/fill and stockpile volumes against a surface or reference plane" },
  { name: "createCrossSection", purpose: "Profile along a polyline through a surface" },
  { name: "compareSurfaces", purpose: "Elevation difference between two terrain surfaces" },
  { name: "placeObject", purpose: "Place a dimensionally correct SceneObject on terrain" },
  { name: "createStaircase", purpose: "Generate stone steps between two terrain points" },
  { name: "renderView", purpose: "Render a server-side image of a viewpoint" },
  { name: "exportDXF", purpose: "Export geometry/measurements to DXF" },
  { name: "exportIFC", purpose: "Export scene objects to IFC" },
  { name: "createReport", purpose: "PDF report of measurements and volumes" },
] as const;

export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry(MILESTONE_1_TOOLS);
}
