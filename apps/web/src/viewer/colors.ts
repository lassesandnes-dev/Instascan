/** Elevation colour ramp (blue → cyan → green → yellow → red) for clouds without RGB. */
const RAMP: [number, number, number][] = [
  [0.19, 0.3, 0.75],
  [0.15, 0.7, 0.85],
  [0.3, 0.75, 0.35],
  [0.95, 0.85, 0.25],
  [0.85, 0.25, 0.2],
];

export function elevationColors(positions: Float32Array, count: number): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 2; i < count * 3; i += 3) {
    const z = positions[i]!;
    if (z < min) min = z;
    if (z > max) max = z;
  }
  const range = max - min || 1;
  const out = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) {
    const t = Math.min(0.9999, Math.max(0, (positions[k * 3 + 2]! - min) / range)) * (RAMP.length - 1);
    const i = Math.floor(t);
    const f = t - i;
    const a = RAMP[i]!;
    const b = RAMP[i + 1]!;
    out[k * 3] = a[0] + (b[0] - a[0]) * f;
    out[k * 3 + 1] = a[1] + (b[1] - a[1]) * f;
    out[k * 3 + 2] = a[2] + (b[2] - a[2]) * f;
  }
  return out;
}
