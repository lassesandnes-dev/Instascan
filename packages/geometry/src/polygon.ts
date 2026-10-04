import type { Vec3 } from "@massefelt/shared";

/** 2D point (planimetric XY). Z of input vertices is ignored by planimetric functions. */
export interface XY {
  x: number;
  y: number;
}

/** Signed shoelace area; positive for counter-clockwise rings. */
export function signedArea(ring: readonly XY[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    // Relative to the first vertex for numerical stability with projected coordinates.
    const xi = ring[i]!.x - ring[0]!.x, yi = ring[i]!.y - ring[0]!.y;
    const xj = ring[j]!.x - ring[0]!.x, yj = ring[j]!.y - ring[0]!.y;
    a += xj * yi - xi * yj;
  }
  return -a / 2;
}

/** Planimetric (horizontal) area of a simple polygon. */
export function polygonArea(ring: readonly XY[]): number {
  return Math.abs(signedArea(ring));
}

export function polygonPerimeter(ring: readonly XY[]): number {
  let p = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

/** Even-odd ray casting point-in-polygon test. */
export function pointInPolygon(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonBounds(ring: readonly XY[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/**
 * Validate a boundary ring (implicitly closed). Returns an error message or
 * null. Rejects fewer than 3 vertices, non-finite values, zero area and
 * self-intersections.
 */
export function validatePolygon(ring: readonly XY[]): string | null {
  if (ring.length < 3) return "A polygon needs at least 3 vertices";
  if (ring.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return "Polygon vertices must be finite";
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!)) {
        return "Polygon edges must not cross each other";
      }
    }
  }
  if (polygonArea(ring) <= 1e-9) return "Polygon has zero area";
  return null;
}

/** Drop a duplicated closing vertex if the caller passed a closed ring. */
export function openRing<T extends XY>(ring: readonly T[]): T[] {
  const out = [...ring];
  if (out.length > 1) {
    const a = out[0]!, b = out[out.length - 1]!;
    if (a.x === b.x && a.y === b.y) out.pop();
  }
  return out;
}

/** Points every `step` units along the closed ring (including the vertices). */
export function densifyRing(ring: readonly XY[], step: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

export function toXY(points: readonly Vec3[]): XY[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
}
