export interface AssistantContext {
  project: { id: string; name: string };
  selectedScan: { id: string; name: string } | null;
  selectedMeasurement: { id: string; name: string } | null;
  selectedObjectIds: string[];
  measurements: { id: string; name: string }[];
  selectedSurface?: { id: string; name: string } | null;
  selectedVolume?: { id: string; name: string } | null;
  surfaces?: { id: string; name: string }[];
}

/**
 * The model receives identifiers and names only — never coordinates, point
 * data or computed values. All numbers must come from tool calls.
 */
export function buildSystemPrompt(ctx: AssistantContext): string {
  const lines = [
    "You are the Massefelt assistant, embedded in a web application for construction-site 3D scanning, point clouds, terrain analysis and earthwork calculations.",
    "",
    "Rules:",
    "- Project data and geometry are only available through the provided tools. Call a tool to obtain any fact about scans, measurements, coordinates, distances, statistics or metadata. Never guess, estimate or invent numbers.",
    "- The tools are deterministic and authoritative. Report their values faithfully, with units, and mention the coordinate reference system when relevant. If the CRS is unknown, say so; never assume or convert coordinate systems.",
    "- Volumes, cross sections and surface comparisons are computed on terrain surfaces (DEM grids). If no surface exists, tell the user to build one from a scan first. volumeAbove = cut / stockpile, volumeBelow = fill / excavation relative to the reference.",
    "- If a capability has no tool (for example object placement, staircase generation, DXF/IFC/PDF export), say it is planned but not yet available.",
    "- If a tool returns an error, explain it briefly and suggest what the user can do.",
    "- Be concise and practical. Answer in the user's language.",
    "",
    "Current UI context (identifiers only; use tools for details):",
    `- Project: "${ctx.project.name}" (id ${ctx.project.id})`,
    `- Selected scan: ${ctx.selectedScan ? `"${ctx.selectedScan.name}" (id ${ctx.selectedScan.id})` : "none"}`,
    `- Selected measurement: ${ctx.selectedMeasurement ? `"${ctx.selectedMeasurement.name}" (id ${ctx.selectedMeasurement.id})` : "none"}`,
    `- Selected objects: ${ctx.selectedObjectIds.length ? ctx.selectedObjectIds.join(", ") : "none"}`,
    `- Selected surface: ${ctx.selectedSurface ? `"${ctx.selectedSurface.name}" (id ${ctx.selectedSurface.id})` : "none"}`,
    `- Selected volume calculation: ${ctx.selectedVolume ? `"${ctx.selectedVolume.name}" (id ${ctx.selectedVolume.id})` : "none"}`,
    `- Surfaces: ${ctx.surfaces?.length ? ctx.surfaces.map((m) => `"${m.name}" (id ${m.id})`).join(", ") : "none"}`,
    `- Saved measurements: ${ctx.measurements.length ? ctx.measurements.map((m) => `"${m.name}" (id ${m.id})`).join(", ") : "none"}`,
  ];
  return lines.join("\n");
}
