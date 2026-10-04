"use client";

import type { ProfileSample } from "@massefelt/geometry";

interface Props {
  samples: ProfileSample[];
  units: string;
  width?: number;
  height?: number;
}

/** Minimal SVG terrain profile: surface (solid) and optional reference surface (dashed). Vertical exaggeration is automatic. */
export function ProfileChart({ samples, units, width = 344, height = 150 }: Props) {
  const pad = { l: 44, r: 8, t: 8, b: 22 };
  const zs = samples.flatMap((s) => [s.z, s.zRef ?? null]).filter((z): z is number => z !== null);
  if (samples.length < 2 || zs.length === 0) return <p className="text-slate-500">No surface data along the line.</p>;
  const length = samples[samples.length - 1]!.station;
  let zMin = Math.min(...zs), zMax = Math.max(...zs);
  if (zMax - zMin < 0.1) {
    zMin -= 0.05;
    zMax += 0.05;
  }
  const sx = (s: number) => pad.l + (s / length) * (width - pad.l - pad.r);
  const sy = (z: number) => pad.t + (1 - (z - zMin) / (zMax - zMin)) * (height - pad.t - pad.b);
  const path = (get: (s: ProfileSample) => number | null | undefined) => {
    let d = "";
    let pen = false;
    for (const s of samples) {
      const z = get(s);
      if (z == null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${sx(s.station).toFixed(1)},${sy(z).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const hasRef = samples.some((s) => s.zRef != null);
  return (
    <svg width={width} height={height} className="block" role="img" aria-label="Terrain profile" data-testid="profile-chart">
      <rect x={pad.l} y={pad.t} width={width - pad.l - pad.r} height={height - pad.t - pad.b} fill="#0f172a" stroke="#334155" />
      {[zMin, (zMin + zMax) / 2, zMax].map((z) => (
        <g key={z}>
          <line x1={pad.l} x2={width - pad.r} y1={sy(z)} y2={sy(z)} stroke="#1e293b" />
          <text x={pad.l - 4} y={sy(z) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
            {z.toFixed(2)}
          </text>
        </g>
      ))}
      <text x={pad.l} y={height - 6} fontSize="9" fill="#94a3b8">0</text>
      <text x={width - pad.r} y={height - 6} fontSize="9" fill="#94a3b8" textAnchor="end">
        {length.toFixed(1)} {units}
      </text>
      {hasRef && <path d={path((s) => s.zRef)} fill="none" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="4 3" />}
      <path d={path((s) => s.z)} fill="none" stroke="#facc15" strokeWidth={1.5} />
    </svg>
  );
}
