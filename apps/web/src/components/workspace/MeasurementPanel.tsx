"use client";

import { measureDistance } from "@massefelt/geometry";
import type { Vec3 } from "@massefelt/shared";
import { fmtCoord, fmtLength, fmtSigned } from "@/lib/format";

interface Props {
  title: string;
  points: Vec3[];
  units: string;
  crsLabel: string;
  saving?: boolean;
  error?: string | null;
  onSave?: () => void;
  onClear?: () => void;
  hint?: string;
}

/** Floating panel showing a pending or saved distance measurement. */
export function MeasurementPanel({ title, points, units, crsLabel, saving, error, onSave, onClear, hint }: Props) {
  const r = points.length === 2 ? measureDistance(points[0]!, points[1]!) : null;
  return (
    <div
      className="absolute left-3 top-3 z-10 w-72 rounded-md border border-slate-700 bg-slate-950/90 p-3 text-xs shadow-xl backdrop-blur"
      data-testid="measurement-panel"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-white">{title}</h3>
        {onClear && (
          <button onClick={onClear} className="text-slate-400 hover:text-white" aria-label="Clear measurement">
            ✕
          </button>
        )}
      </div>
      {hint && <p className="mb-2 text-slate-400">{hint}</p>}
      {points.map((p, i) => (
        <div key={i} className="mb-1 font-mono text-[11px] text-slate-300">
          <span className={i === 0 ? "text-orange-400" : "text-cyan-300"}>{i === 0 ? "A" : "B"}</span>{" "}
          {fmtCoord(p.x)}, {fmtCoord(p.y)}, {fmtCoord(p.z)}
        </div>
      ))}
      {r && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums" data-testid="measurement-result">
          <dt className="text-slate-400">3D distance</dt>
          <dd className="text-right text-base font-semibold text-yellow-300" data-testid="distance-3d">
            {fmtLength(r.distance3d, units)}
          </dd>
          <dt className="text-slate-400">Horizontal</dt>
          <dd className="text-right">{fmtLength(r.horizontalDistance, units)}</dd>
          <dt className="text-slate-400">ΔX</dt>
          <dd className="text-right" data-testid="dx">{fmtSigned(r.dx, units)}</dd>
          <dt className="text-slate-400">ΔY</dt>
          <dd className="text-right" data-testid="dy">{fmtSigned(r.dy, units)}</dd>
          <dt className="text-slate-400">ΔZ</dt>
          <dd className="text-right" data-testid="dz">{fmtSigned(r.dz, units)}</dd>
          <dt className="text-slate-400">Slope</dt>
          <dd className="text-right">{r.slopePercent === null ? "vertical" : `${r.slopePercent.toFixed(1)} %`}</dd>
        </dl>
      )}
      <p className="mt-2 text-[10px] text-slate-500">{crsLabel}</p>
      {error && <p className="mt-1 text-red-400" role="alert">{error}</p>}
      {onSave && r && (
        <button
          onClick={onSave}
          disabled={saving}
          className="mt-2 w-full rounded bg-sky-600 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          data-testid="save-measurement"
        >
          {saving ? "Saving…" : "Save measurement"}
        </button>
      )}
    </div>
  );
}
