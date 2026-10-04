"use client";

import { useState } from "react";
import { polygonArea, type XY } from "@massefelt/geometry";
import type { SurfaceSummary, VolumeRecord, VolumeReferenceInput } from "@/lib/api";
import { fmtArea, fmtLength, fmtVolume } from "@/lib/format";

interface Props {
  boundary: XY[];
  closed: boolean;
  surfaces: SurfaceSummary[];
  defaultSurfaceId: string | null;
  units: string;
  crsLabel: string;
  saving: boolean;
  error: string | null;
  /** Saved calculation to display (read-only mode). */
  volume?: VolumeRecord | null;
  onClose?: () => void;
  onUndo?: () => void;
  onCalculate?: (input: { surfaceId: string; reference: VolumeReferenceInput; name?: string }) => void;
  onClear: () => void;
}

const field = "w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white";

export function VolumePanel(p: Props) {
  const [surfaceId, setSurfaceId] = useState(p.defaultSurfaceId ?? p.surfaces[0]?.id ?? "");
  const [refType, setRefType] = useState<VolumeReferenceInput["type"]>("boundary-plane");
  const [elevation, setElevation] = useState("");
  const [refSurfaceId, setRefSurfaceId] = useState("");
  const [name, setName] = useState("");
  const area = p.boundary.length >= 3 ? polygonArea(p.boundary) : 0;
  const v = p.volume;

  function submit() {
    let reference: VolumeReferenceInput;
    if (refType === "elevation") reference = { type: "elevation", z: Number(elevation) };
    else if (refType === "surface") reference = { type: "surface", surfaceId: refSurfaceId };
    else reference = { type: refType };
    p.onCalculate?.({ surfaceId, reference, name: name || undefined });
  }

  const canSubmit =
    p.closed && surfaceId && (refType !== "elevation" || Number.isFinite(Number(elevation)) && elevation !== "") && (refType !== "surface" || refSurfaceId);

  return (
    <div className="absolute left-3 top-3 z-10 w-80 rounded-md border border-slate-700 bg-slate-950/90 p-3 text-xs shadow-xl backdrop-blur" data-testid="volume-panel">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-white">{v ? v.name : "Volume calculation"}</h3>
        <button onClick={p.onClear} className="text-slate-400 hover:text-white" aria-label="Close volume panel">✕</button>
      </div>

      {!v && !p.closed && (
        <div className="space-y-2">
          <p className="text-slate-400">Click points to draw the boundary ({p.boundary.length} vertices). Enter closes, Backspace undoes, Esc cancels.</p>
          <div className="flex gap-2">
            <button onClick={p.onUndo} disabled={!p.boundary.length} className="rounded bg-slate-800 px-2 py-1 text-slate-200 disabled:opacity-40">Undo</button>
            <button onClick={p.onClose} disabled={p.boundary.length < 3} className="rounded bg-sky-600 px-2 py-1 font-medium text-white disabled:opacity-40" data-testid="close-polygon">
              Close polygon
            </button>
          </div>
        </div>
      )}

      {(p.closed || v) && (
        <p className="mb-2 tabular-nums text-slate-300">
          Boundary area: <span className="text-white">{fmtArea(v?.area ?? area, p.units)}</span>
        </p>
      )}

      {!v && p.closed && (
        <div className="space-y-2">
          {p.surfaces.length === 0 ? (
            <p className="text-amber-300">No surface yet. Build one from a scan in the project tree first.</p>
          ) : (
            <>
              <label className="block text-slate-400">
                Surface
                <select value={surfaceId} onChange={(e) => setSurfaceId(e.target.value)} className={field} data-testid="volume-surface">
                  {p.surfaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="block text-slate-400">
                Reference
                <select value={refType} onChange={(e) => setRefType(e.target.value as VolumeReferenceInput["type"])} className={field} data-testid="volume-reference">
                  <option value="boundary-plane">Base plane fitted to the boundary (stockpile/pit)</option>
                  <option value="lowest-boundary">Horizontal through lowest boundary point</option>
                  <option value="elevation">Fixed elevation (design level)</option>
                  <option value="surface">Another surface (before/after)</option>
                </select>
              </label>
              {refType === "elevation" && (
                <label className="block text-slate-400">
                  Elevation ({p.units})
                  <input value={elevation} onChange={(e) => setElevation(e.target.value)} inputMode="decimal" className={field} placeholder="e.g. 112.50" />
                </label>
              )}
              {refType === "surface" && (
                <label className="block text-slate-400">
                  Reference surface (base / before)
                  <select value={refSurfaceId} onChange={(e) => setRefSurfaceId(e.target.value)} className={field}>
                    <option value="">Select…</option>
                    {p.surfaces.filter((s) => s.id !== surfaceId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              )}
              <label className="block text-slate-400">
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={field} placeholder="Optional" />
              </label>
              <button onClick={submit} disabled={!canSubmit || p.saving} className="w-full rounded bg-sky-600 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50" data-testid="calculate-volume">
                {p.saving ? "Calculating…" : "Calculate and save"}
              </button>
            </>
          )}
        </div>
      )}

      {v && <VolumeResultView volume={v} />}
      <p className="mt-2 text-[10px] text-slate-500">{p.crsLabel}</p>
      {p.error && <p className="mt-1 text-red-400" role="alert">{p.error}</p>}
    </div>
  );
}

function VolumeResultView({ volume: v }: { volume: VolumeRecord }) {
  const r = v.result as {
    analyzedArea?: number;
    voidFraction?: number;
    cellSize?: number;
    warnings?: string[];
    reference?: { type: string; z?: number; plane?: { rmsResidual: number } };
  };
  const refLabel =
    v.method === "elevation"
      ? `Fixed elevation ${fmtLength(v.referenceElevation ?? 0, v.units)}`
      : v.method === "lowest-boundary"
        ? `Lowest boundary point ${fmtLength(v.referenceElevation ?? 0, v.units)}`
        : v.method === "boundary-plane"
          ? `Boundary base plane (RMS ${fmtLength(r.reference?.plane?.rmsResidual ?? 0, v.units)})`
          : "Reference surface";
  return (
    <div data-testid="volume-result">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
        <dt className="text-slate-400">Above (cut / pile)</dt>
        <dd className="text-right text-base font-semibold text-yellow-300" data-testid="volume-above">{fmtVolume(v.volumeAbove, v.units)}</dd>
        <dt className="text-slate-400">Below (fill / pit)</dt>
        <dd className="text-right text-base font-semibold text-cyan-300" data-testid="volume-below">{fmtVolume(v.volumeBelow, v.units)}</dd>
        <dt className="text-slate-400">Net</dt>
        <dd className="text-right">{fmtVolume(v.net, v.units)}</dd>
        <dt className="text-slate-400">Analysed area</dt>
        <dd className="text-right">{fmtArea(r.analyzedArea, v.units)}</dd>
        <dt className="text-slate-400">No data</dt>
        <dd className="text-right">{((r.voidFraction ?? 0) * 100).toFixed(1)} %</dd>
        <dt className="text-slate-400">Grid cell</dt>
        <dd className="text-right">{fmtLength(r.cellSize ?? 0, v.units, 2)}</dd>
      </dl>
      <p className="mt-1 text-slate-400">Reference: {refLabel}</p>
      {r.warnings?.map((w) => (
        <p key={w} className="mt-1 text-amber-300">⚠ {w}</p>
      ))}
    </div>
  );
}
