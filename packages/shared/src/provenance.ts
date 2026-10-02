import { z } from "zod";

/**
 * Known acquisition sources. "unknown" is a legitimate value: the platform must
 * never guess where data came from.
 */
export const DATA_SOURCES = [
  "unknown",
  "phone-camera",
  "insta360-x5",
  "drone-photogrammetry",
  "lidar",
  "total-station",
  "gnss",
  "hoydedata",
  "file-import",
] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

/**
 * Provenance carried by every stored or processed asset.
 *
 * Coordinate reference system and vertical datum are stored exactly as
 * declared by the user/source. The platform NEVER silently converts between
 * coordinate systems; a missing CRS stays `null` ("unknown") and is shown as
 * such in the UI.
 */
export const provenanceSchema = z.object({
  originalFilename: z.string().min(1).max(512),
  source: z.enum(DATA_SOURCES),
  acquisitionDate: z.coerce.date().nullable(),
  crs: z.string().trim().min(1).max(128).nullable(),
  verticalDatum: z.string().trim().min(1).max(128).nullable(),
  processingMethod: z.string().min(1).max(128),
  processingVersion: z.string().min(1).max(64),
  units: z.enum(["m", "mm", "cm", "ft", "us-ft"]),
  parentAssetId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/** Human-readable CRS label; never invents a CRS. */
export function describeCrs(crs: string | null | undefined): string {
  return crs && crs.trim() ? crs.trim() : "Unknown CRS (not specified)";
}

export function describeVerticalDatum(datum: string | null | undefined): string {
  return datum && datum.trim() ? datum.trim() : "Unknown vertical datum";
}
