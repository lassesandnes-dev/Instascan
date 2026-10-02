import { z } from "zod";

/**
 * Dimensionally correct scene objects placed on scanned terrain.
 *
 * All dimensions are metres, positions are world coordinates in the project
 * CRS, rotation is radians (XYZ). Milestone 1 defines the model only;
 * placement tools and the staircase generator are planned.
 */
const vec3 = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });
const positive = z.number().finite().positive();

export const SCENE_OBJECT_TYPES = ["stone-step", "pipe", "manhole", "box", "staircase"] as const;
export type SceneObjectType = (typeof SCENE_OBJECT_TYPES)[number];

export const stoneStepDimensionsSchema = z.object({ width: positive, depth: positive, height: positive });
export const pipeDimensionsSchema = z.object({ outerDiameter: positive, wallThickness: positive, length: positive });
export const manholeDimensionsSchema = z.object({ innerDiameter: positive, depth: positive, wallThickness: positive });
export const boxDimensionsSchema = z.object({ width: positive, depth: positive, height: positive });
export const staircaseDimensionsSchema = z.object({
  stepWidth: positive,
  stepDepth: positive,
  stepHeight: positive,
  stepCount: z.number().int().positive().max(500),
});

export const sceneObjectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stone-step"), dimensions: stoneStepDimensionsSchema }),
  z.object({ type: z.literal("pipe"), dimensions: pipeDimensionsSchema }),
  z.object({ type: z.literal("manhole"), dimensions: manholeDimensionsSchema }),
  z.object({ type: z.literal("box"), dimensions: boxDimensionsSchema }),
  z.object({ type: z.literal("staircase"), dimensions: staircaseDimensionsSchema }),
]).and(
  z.object({
    position: vec3,
    rotation: vec3,
    scale: vec3.refine((s) => s.x > 0 && s.y > 0 && s.z > 0, "Scale must be positive"),
    source: z.enum(["user", "ai-tool", "generator", "import"]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }),
);
export type SceneObjectSpec = z.infer<typeof sceneObjectSchema>;

/** Example from the product brief: a 1.2 × 0.4 × 0.15 m stone step. */
export const EXAMPLE_STONE_STEP: SceneObjectSpec = {
  type: "stone-step",
  dimensions: { width: 1.2, depth: 0.4, height: 0.15 },
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  source: "user",
  metadata: {},
};

/** Effective axis-aligned size (before rotation) of box-like objects, in metres. */
export function nominalSize(obj: SceneObjectSpec): { x: number; y: number; z: number } {
  switch (obj.type) {
    case "stone-step":
    case "box":
      return { x: obj.dimensions.width * obj.scale.x, y: obj.dimensions.depth * obj.scale.y, z: obj.dimensions.height * obj.scale.z };
    case "pipe":
      return { x: obj.dimensions.length * obj.scale.x, y: obj.dimensions.outerDiameter * obj.scale.y, z: obj.dimensions.outerDiameter * obj.scale.z };
    case "manhole": {
      const d = obj.dimensions.innerDiameter + 2 * obj.dimensions.wallThickness;
      return { x: d * obj.scale.x, y: d * obj.scale.y, z: obj.dimensions.depth * obj.scale.z };
    }
    case "staircase":
      return {
        x: obj.dimensions.stepWidth * obj.scale.x,
        y: obj.dimensions.stepDepth * obj.dimensions.stepCount * obj.scale.y,
        z: obj.dimensions.stepHeight * obj.dimensions.stepCount * obj.scale.z,
      };
  }
}
