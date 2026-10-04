import { elevationAt, type DemGrid } from "./grid";
import type { XY } from "./polygon";

export interface ProfileSample {
  /** Distance along the line from its start (horizontal). */
  station: number;
  x: number;
  y: number;
  /** Surface elevation, null where the surface has no data. */
  z: number | null;
  /** Elevation of an optional second (reference) surface. */
  zRef?: number | null;
}

export interface CrossSectionResult {
  length: number;
  interval: number;
  samples: ProfileSample[];
  zMin: number | null;
  zMax: number | null;
  /** Fraction of samples without data. */
  voidFraction: number;
}

export const MAX_PROFILE_SAMPLES = 10_000;

/** Sample a surface along a polyline every `interval` units (vertices always included). */
export function crossSection(grid: DemGrid, line: readonly XY[], interval: number, reference?: DemGrid): CrossSectionResult {
  if (line.length < 2) throw new RangeError("A section line needs at least 2 points");
  if (!(interval > 0)) throw new RangeError("interval must be positive");
  let length = 0;
  for (let i = 1; i < line.length; i++) length += Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y);
  if (length === 0) throw new RangeError("Section line has zero length");
  const step = Math.max(interval, length / MAX_PROFILE_SAMPLES);

  const samples: ProfileSample[] = [];
  let station = 0;
  const push = (x: number, y: number, s: number) => {
    const z = elevationAt(grid, x, y);
    const sample: ProfileSample = { station: s, x, y, z: Number.isNaN(z) ? null : z };
    if (reference) {
      const zr = elevationAt(reference, x, y);
      sample.zRef = Number.isNaN(zr) ? null : zr;
    }
    samples.push(sample);
  };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(segLen / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, station + segLen * t);
    }
    station += segLen;
  }
  const last = line[line.length - 1]!;
  push(last.x, last.y, length);

  const zs = samples.map((s) => s.z).filter((z): z is number => z !== null);
  return {
    length,
    interval: step,
    samples,
    zMin: zs.length ? Math.min(...zs) : null,
    zMax: zs.length ? Math.max(...zs) : null,
    voidFraction: 1 - zs.length / samples.length,
  };
}

/** Evenly thin a profile to at most `max` samples (always keeps first and last). */
export function thinProfile(samples: ProfileSample[], max: number): ProfileSample[] {
  if (samples.length <= max) return samples;
  const out: ProfileSample[] = [];
  for (let i = 0; i < max; i++) out.push(samples[Math.round((i * (samples.length - 1)) / (max - 1))]!);
  return out;
}
