"use client";

import { useState } from "react";
import type { ProfileSample } from "@massefelt/geometry";
import type { CrossSectionRecord, SurfaceSummary } from "@/lib/api";
import { fmtLength } from "@/lib/format";
import { ProfileChart } from "./ProfileChart";

interface Props {
  pointCount: number;
  surfaces: SurfaceSummary[];
  defaultSurfaceId: string | null;
  units: string;
  saving: boolean;
  error: string | null;
  section?: CrossSectionRecord | null;
  onCreate?: (input: { surfaceId: string; referenceSurfaceId: string | null; name?: string }) => void;
  onClear: () => void;
}

const field = "w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white";

export function SectionPanel(p: Props) {
  const [surfaceId, setSurfaceId] = useState(p.defaultSurfaceId ?? p.surfaces[0]?.id ?? "");
  const [refId, setRefId] = useState("");
  const s = p.section;
  const result = s?.result as { samples?: ProfileSample[]; zMin?: number | null; zMax?: number | null } | undefined;
  return (
    <div className="absolute bottom-3 left-3 z-10 w-[23rem] rounded-md border border-slate-700 bg-slate-950/90 p-3 text-xs shadow-xl backdrop-blur" data-testid="section-panel">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-white">{s ? s.name : "Cross section"}</h3>
        <button onClick={p.onClear} className="text-slate-400 hover:text-white" aria-label="Close section panel">✕</button>
      </div>
      {!s && p.pointCount < 2 && <p className="text-slate-400">Click the start and end of the section line ({p.pointCount}/2).</p>}
      {!s && p.pointCount >= 2 && (
        p.surfaces.length === 0 ? (
          <p className="text-amber-300">No surface yet. Build one from a scan in the project tree first.</p>
        ) : (
          <div className="space-y-2">
            <label className="block text-slate-400">
              Surface
              <select value={surfaceId} onChange={(e) => setSurfaceId(e.target.value)} className={field}>
                {p.surfaces.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="block text-slate-400">
              Compare with (optional)
              <select value={refId} onChange={(e) => setRefId(e.target.value)} className={field}>
                <option value="">None</option>
                {p.surfaces.filter((x) => x.id !== surfaceId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <button
              onClick={() => p.onCreate?.({ surfaceId, referenceSurfaceId: refId || null })}
              disabled={!surfaceId || p.saving}
              className="w-full rounded bg-sky-600 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              data-testid="create-section"
            >
              {p.saving ? "Computing…" : "Create section"}
            </button>
          </div>
        )
      )}
      {s && result?.samples && (
        <>
          <ProfileChart samples={result.samples} units={s.units} />
          <p className="mt-1 tabular-nums text-slate-400">
            Length {fmtLength(s.length ?? 0, s.units, 2)} · Z {result.zMin?.toFixed(3) ?? "—"} – {result.zMax?.toFixed(3) ?? "—"} {s.units}
            {s.referenceSurfaceId && <span className="text-violet-300"> · dashed = reference</span>}
          </p>
        </>
      )}
      {p.error && <p className="mt-1 text-red-400" role="alert">{p.error}</p>}
    </div>
  );
}
