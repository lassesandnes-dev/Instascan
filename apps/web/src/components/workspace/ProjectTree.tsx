"use client";

import { describeCrs, describeVerticalDatum } from "@massefelt/shared";
import type { MeasurementRecord, ScanDetail, ScanSummary } from "@/lib/api";
import { fmtCoord, fmtCount, fmtLength } from "@/lib/format";

interface Props {
  scans: ScanSummary[];
  measurements: MeasurementRecord[];
  selectedScanId: string | null;
  selectedMeasurementId: string | null;
  hiddenScanIds: Set<string>;
  loadingScanIds: Set<string>;
  selectedScanDetail: ScanDetail | null;
  onSelectScan: (id: string | null) => void;
  onToggleScanVisible: (id: string) => void;
  onDeleteScan: (id: string) => void;
  onSelectMeasurement: (id: string | null) => void;
  onDeleteMeasurement: (id: string) => void;
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="border-b border-slate-800 py-2">
      <h3 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {title}
        {count !== undefined && <span className="ml-1 text-slate-500">({count})</span>}
      </h3>
      {children}
    </section>
  );
}

const statusColor: Record<string, string> = {
  READY: "text-emerald-400",
  PROCESSING: "text-amber-400",
  UPLOADED: "text-slate-400",
  FAILED: "text-red-400",
};

export function ProjectTree(p: Props) {
  return (
    <div className="flex h-full flex-col overflow-y-auto text-sm" data-testid="project-tree">
      <Section title="Scans" count={p.scans.length}>
        {p.scans.length === 0 && <p className="px-3 text-xs text-slate-500">No scans. Use “Upload scan”.</p>}
        <ul>
          {p.scans.map((s) => (
            <li
              key={s.id}
              className={`group flex items-center gap-2 px-3 py-1 ${p.selectedScanId === s.id ? "bg-sky-900/40" : "hover:bg-slate-900"}`}
            >
              <input
                type="checkbox"
                checked={!p.hiddenScanIds.has(s.id)}
                onChange={() => p.onToggleScanVisible(s.id)}
                disabled={s.status !== "READY"}
                className="accent-sky-500"
                aria-label={`Show ${s.name}`}
              />
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => p.onSelectScan(p.selectedScanId === s.id ? null : s.id)}
                data-testid="scan-item"
              >
                <div className="truncate text-slate-100">{s.name}</div>
                <div className="text-[11px] text-slate-500">
                  <span className={statusColor[s.status] ?? ""}>{p.loadingScanIds.has(s.id) ? "loading…" : s.status.toLowerCase()}</span>
                  {" · "}
                  {fmtCount(s.pointCount)} pts
                </div>
              </button>
              <button
                onClick={() => {
                  if (confirm(`Delete scan “${s.name}”? This removes its files and point cloud.`)) p.onDeleteScan(s.id);
                }}
                className="invisible text-xs text-slate-500 hover:text-red-400 group-hover:visible"
                aria-label={`Delete ${s.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Surfaces">
        <p className="px-3 text-xs text-slate-500">
          Surface (TIN/DEM) generation <span className="badge-planned">Planned</span>
        </p>
      </Section>

      <Section title="Objects">
        <p className="px-3 text-xs text-slate-500">
          Object placement <span className="badge-planned">Planned</span>
        </p>
      </Section>

      <Section title="Measurements" count={p.measurements.length}>
        {p.measurements.length === 0 && <p className="px-3 text-xs text-slate-500">No saved measurements.</p>}
        <ul data-testid="measurement-list">
          {p.measurements.map((m) => (
            <li
              key={m.id}
              className={`group flex items-center gap-2 px-3 py-1 ${p.selectedMeasurementId === m.id ? "bg-sky-900/40" : "hover:bg-slate-900"}`}
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => p.onSelectMeasurement(p.selectedMeasurementId === m.id ? null : m.id)}
              >
                <div className="truncate text-slate-100">{m.name}</div>
                <div className="text-[11px] tabular-nums text-slate-400">{fmtLength(m.value, m.units)}</div>
              </button>
              <button
                onClick={() => p.onDeleteMeasurement(m.id)}
                className="invisible text-xs text-slate-500 hover:text-red-400 group-hover:visible"
                aria-label={`Delete ${m.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {p.selectedScanDetail && <ScanInfo scan={p.selectedScanDetail} />}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className="truncate text-right text-slate-200" title={typeof v === "string" ? v : undefined}>
        {v}
      </dd>
    </div>
  );
}

function ScanInfo({ scan }: { scan: ScanDetail }) {
  const pc = scan.pointCloud;
  return (
    <section className="p-3 text-[11px]" data-testid="scan-info">
      <h3 className="pb-1 font-semibold uppercase tracking-wider text-slate-400">Scan metadata</h3>
      <dl className="space-y-0.5">
        <Row k="File" v={scan.originalFilename ?? "—"} />
        <Row k="Source" v={scan.source} />
        <Row k="Acquired" v={scan.acquisitionDate ? scan.acquisitionDate.slice(0, 10) : "Unknown"} />
        <Row k="CRS" v={describeCrs(scan.crs)} />
        <Row k="Vertical datum" v={describeVerticalDatum(scan.verticalDatum)} />
        <Row k="Units" v={scan.units} />
        <Row k="Points" v={fmtCount(scan.pointCount)} />
        {pc && (
          <>
            <Row k="Min" v={`${fmtCoord(pc.bbox.min.x)}, ${fmtCoord(pc.bbox.min.y)}, ${fmtCoord(pc.bbox.min.z)}`} />
            <Row k="Max" v={`${fmtCoord(pc.bbox.max.x)}, ${fmtCoord(pc.bbox.max.y)}, ${fmtCoord(pc.bbox.max.z)}`} />
            <Row k="Processing" v={`${pc.provenance.processingMethod} v${pc.provenance.processingVersion}`} />
            <Row k="Colour" v={pc.hasColor ? "RGB" : "Elevation ramp"} />
          </>
        )}
        {scan.statusMessage && <Row k="Note" v={scan.statusMessage} />}
      </dl>
    </section>
  );
}
