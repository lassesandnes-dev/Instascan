import { z } from "zod";
import {
  computeVolume,
  crossSection,
  GEOMETRY_ENGINE_VERSION,
  thinProfile,
  VolumeError,
  type DemGrid,
  type VolumeReference,
  type VolumeResult,
} from "@massefelt/geometry";
import { AppError, describeCrs, NotFoundError, ValidationError } from "@massefelt/shared";
import type { SurfaceSummary } from "./data-port";
import type { ToolContext, ToolDefinition } from "./types";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id");
const xy = z.object({ x: z.number().finite(), y: z.number().finite() });

function defineTool<S extends z.ZodType, R>(def: ToolDefinition<S, R>): ToolDefinition<S, R> {
  return def;
}

async function requireSurface(ctx: ToolContext, surfaceId: string | undefined): Promise<{ meta: SurfaceSummary; grid: DemGrid }> {
  const resolved = surfaceId ?? ctx.selection.surfaceId ?? null;
  if (!resolved) throw new ValidationError("No surfaceId given and no surface is selected");
  const meta = await ctx.data.getSurface(ctx.projectId, resolved);
  if (!meta) throw new NotFoundError("Surface", resolved);
  const grid = await ctx.data.loadSurfaceGrid(ctx.projectId, resolved);
  if (!grid) throw new NotFoundError("Surface grid", resolved);
  return { meta, grid };
}

function assertSameFrame(a: SurfaceSummary, b: SurfaceSummary) {
  // Never compare surfaces in different (declared) coordinate systems or units.
  if ((a.crs ?? null) !== (b.crs ?? null) || a.units !== b.units) {
    throw new ValidationError(
      `Surfaces use different coordinate systems/units (${describeCrs(a.crs)} ${a.units} vs ${describeCrs(b.crs)} ${b.units}); no conversion is performed`,
    );
  }
}

async function boundaryFrom(ctx: ToolContext, boundary: { x: number; y: number }[] | undefined, fromVolumeId: string | undefined) {
  if (boundary) return boundary;
  if (fromVolumeId) {
    const v = await ctx.data.getVolume(ctx.projectId, fromVolumeId);
    if (!v) throw new NotFoundError("Volume calculation", fromVolumeId);
    if (!v.boundary) throw new ValidationError("That volume calculation has no stored boundary");
    return v.boundary;
  }
  return undefined;
}

function runVolume(grid: DemGrid, reference: VolumeReference, boundary?: { x: number; y: number }[]): VolumeResult {
  try {
    return computeVolume(grid, reference, boundary);
  } catch (err) {
    if (err instanceof VolumeError) throw new AppError("volume_error", err.message, 422);
    throw err;
  }
}

function presentVolume(result: VolumeResult, meta: SurfaceSummary) {
  return {
    ...result,
    units: { length: meta.units, area: `${meta.units}²`, volume: `${meta.units}³` },
    crs: meta.crs,
    note: "volumeAbove = material above the reference (cut / stockpile); volumeBelow = space below the reference (fill / excavation).",
    engineVersion: GEOMETRY_ENGINE_VERSION,
  };
}

export const listSurfacesTool = defineTool({
  name: "listSurfaces",
  description: "List terrain surfaces (DEM grids) in the project with resolution, elevation range, CRS and source scan.",
  inputSchema: z.object({}).strict(),
  readOnly: true,
  async execute(_input, ctx) {
    const surfaces = await ctx.data.listSurfaces(ctx.projectId);
    return { count: surfaces.length, surfaces };
  },
});

export const getSurfaceMetadataTool = defineTool({
  name: "getSurfaceMetadata",
  description: "Get metadata and provenance of one terrain surface. Defaults to the selected surface.",
  inputSchema: z.object({ surfaceId: id.optional() }).strict(),
  readOnly: true,
  async execute({ surfaceId }, ctx) {
    const resolved = surfaceId ?? ctx.selection.surfaceId ?? null;
    if (!resolved) throw new ValidationError("No surfaceId given and no surface is selected");
    const meta = await ctx.data.getSurface(ctx.projectId, resolved);
    if (!meta) throw new NotFoundError("Surface", resolved);
    return { ...meta, crsLabel: describeCrs(meta.crs) };
  },
});

const referenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("elevation"), z: z.number().finite().describe("Fixed reference elevation, e.g. design/formation level") }).strict(),
  z.object({ type: z.literal("lowest-boundary") }).strict().describe("Horizontal base through the lowest point on the boundary"),
  z.object({ type: z.literal("boundary-plane") }).strict().describe("Best-fit base plane through the boundary (stockpile on slope)"),
  z.object({ type: z.literal("surface"), surfaceId: id.describe("Reference surface, e.g. original terrain") }).strict(),
]);

export const calculateVolumeTool = defineTool({
  name: "calculateVolume",
  description:
    "Compute cut/fill or stockpile volume of a terrain surface against a reference (fixed elevation, lowest boundary point, best-fit boundary plane, or another surface) inside a boundary polygon. Use fromVolumeId to reuse the boundary of a saved volume calculation; omit both to use the whole surface. Does not save anything.",
  inputSchema: z
    .object({
      surfaceId: id.optional().describe("Surface to measure; omit to use the selected surface"),
      reference: referenceSchema,
      boundary: z.array(xy).min(3).max(2000).optional().describe("Closed boundary ring in the surface CRS (XY)"),
      fromVolumeId: id.optional(),
    })
    .strict(),
  readOnly: true,
  async execute({ surfaceId, reference, boundary, fromVolumeId }, ctx) {
    const { meta, grid } = await requireSurface(ctx, surfaceId);
    let ref: VolumeReference;
    if (reference.type === "surface") {
      const base = await requireSurface(ctx, reference.surfaceId);
      assertSameFrame(meta, base.meta);
      ref = { type: "surface", grid: base.grid };
    } else {
      ref = reference;
    }
    const ring = await boundaryFrom(ctx, boundary, fromVolumeId);
    return { surfaceId: meta.id, ...presentVolume(runVolume(grid, ref, ring), meta) };
  },
});

export const compareSurfacesTool = defineTool({
  name: "compareSurfaces",
  description:
    "Compare two terrain surfaces (e.g. before/after excavation): volume where the top surface is above (fill/added) and below (cut/removed) the base surface, optionally inside a boundary.",
  inputSchema: z
    .object({
      baseSurfaceId: id.describe("Earlier / original surface"),
      topSurfaceId: id.describe("Later / current surface"),
      boundary: z.array(xy).min(3).max(2000).optional(),
      fromVolumeId: id.optional(),
    })
    .strict(),
  readOnly: true,
  async execute({ baseSurfaceId, topSurfaceId, boundary, fromVolumeId }, ctx) {
    const top = await requireSurface(ctx, topSurfaceId);
    const base = await requireSurface(ctx, baseSurfaceId);
    assertSameFrame(top.meta, base.meta);
    const ring = await boundaryFrom(ctx, boundary, fromVolumeId);
    const r = presentVolume(runVolume(top.grid, { type: "surface", grid: base.grid }, ring), top.meta);
    return {
      baseSurfaceId,
      topSurfaceId,
      addedVolume: r.volumeAbove,
      removedVolume: r.volumeBelow,
      ...r,
    };
  },
});

export const createCrossSectionTool = defineTool({
  name: "createCrossSection",
  description:
    "Compute a terrain profile along a polyline on a surface (optionally with a reference surface). Returns length, min/max elevation and up to 100 samples. Does not save anything.",
  inputSchema: z
    .object({
      surfaceId: id.optional(),
      line: z.array(xy).min(2).max(100).describe("Polyline vertices in the surface CRS"),
      interval: z.number().positive().max(1000).optional().describe("Sample spacing; defaults to the surface cell size"),
      referenceSurfaceId: id.optional(),
    })
    .strict(),
  readOnly: true,
  async execute({ surfaceId, line, interval, referenceSurfaceId }, ctx) {
    const { meta, grid } = await requireSurface(ctx, surfaceId);
    let refGrid: DemGrid | undefined;
    if (referenceSurfaceId) {
      const ref = await requireSurface(ctx, referenceSurfaceId);
      assertSameFrame(meta, ref.meta);
      refGrid = ref.grid;
    }
    let section;
    try {
      section = crossSection(grid, line, interval ?? grid.cellSize, refGrid);
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : String(err));
    }
    return {
      surfaceId: meta.id,
      length: section.length,
      interval: section.interval,
      zMin: section.zMin,
      zMax: section.zMax,
      voidFraction: section.voidFraction,
      sampleCount: section.samples.length,
      samples: thinProfile(section.samples, 100),
      crs: meta.crs,
      units: meta.units,
      engineVersion: GEOMETRY_ENGINE_VERSION,
    };
  },
});

export const listVolumeCalculationsTool = defineTool({
  name: "listVolumeCalculations",
  description: "List saved volume calculations in the project with their volumes.",
  inputSchema: z.object({}).strict(),
  readOnly: true,
  async execute(_input, ctx) {
    const list = await ctx.data.listVolumes(ctx.projectId);
    return {
      count: list.length,
      volumes: list.map(({ id, name, method, area, volumeAbove, volumeBelow, net, units, createdAt }) => ({
        id, name, method, area, volumeAbove, volumeBelow, net, units, createdAt,
      })),
    };
  },
});

export const getVolumeCalculationTool = defineTool({
  name: "getVolumeCalculation",
  description: "Get a saved volume calculation (boundary, reference, volumes, warnings). Defaults to the selected volume.",
  inputSchema: z.object({ volumeId: id.optional() }).strict(),
  readOnly: true,
  async execute({ volumeId }, ctx) {
    const resolved = volumeId ?? ctx.selection.volumeId ?? null;
    if (!resolved) throw new ValidationError("No volumeId given and no volume calculation is selected");
    const v = await ctx.data.getVolume(ctx.projectId, resolved);
    if (!v) throw new NotFoundError("Volume calculation", resolved);
    return v;
  },
});

export const listCrossSectionsTool = defineTool({
  name: "listCrossSections",
  description: "List saved cross sections in the project with their length and elevation range.",
  inputSchema: z.object({}).strict(),
  readOnly: true,
  async execute(_input, ctx) {
    const list = await ctx.data.listCrossSections(ctx.projectId);
    return {
      count: list.length,
      crossSections: list.map((c) => ({
        id: c.id,
        name: c.name,
        surfaceId: c.surfaceId,
        length: c.length,
        zMin: (c.result as { zMin?: number }).zMin ?? null,
        zMax: (c.result as { zMax?: number }).zMax ?? null,
        units: c.units,
        createdAt: c.createdAt,
      })),
    };
  },
});

export const TERRAIN_TOOLS = [
  listSurfacesTool,
  getSurfaceMetadataTool,
  calculateVolumeTool,
  compareSurfacesTool,
  createCrossSectionTool,
  listVolumeCalculationsTool,
  getVolumeCalculationTool,
  listCrossSectionsTool,
] as unknown as ToolDefinition[];
