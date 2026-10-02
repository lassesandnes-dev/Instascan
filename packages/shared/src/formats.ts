/**
 * Registry of point-cloud / terrain input formats. Only formats with
 * `status: "supported"` are accepted by the upload pipeline; everything else
 * is shown in the UI as "Planned".
 */
export interface InputFormat {
  id: string;
  label: string;
  extensions: readonly string[];
  status: "supported" | "planned";
}

export const INPUT_FORMATS: readonly InputFormat[] = [
  { id: "xyz", label: "XYZ / CSV point list", extensions: [".xyz", ".csv", ".txt", ".pts"], status: "supported" },
  { id: "las", label: "LAS / LAZ", extensions: [".las", ".laz"], status: "planned" },
  { id: "e57", label: "E57", extensions: [".e57"], status: "planned" },
  { id: "ply", label: "PLY", extensions: [".ply"], status: "planned" },
  { id: "obj", label: "OBJ mesh", extensions: [".obj"], status: "planned" },
  { id: "gltf", label: "GLB / glTF", extensions: [".glb", ".gltf"], status: "planned" },
  { id: "geotiff", label: "GeoTIFF DEM", extensions: [".tif", ".tiff"], status: "planned" },
  { id: "asc", label: "ASCII grid", extensions: [".asc"], status: "planned" },
] as const;

export function detectFormat(filename: string): InputFormat | undefined {
  const lower = filename.toLowerCase();
  return INPUT_FORMATS.find((f) => f.extensions.some((ext) => lower.endsWith(ext)));
}
