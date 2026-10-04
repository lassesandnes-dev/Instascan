"use client";

import { describeCrs, describeVerticalDatum } from "@massefelt/shared";
import { useState } from "react";
import type { CrossSectionRecord, MeasurementRecord, ScanDetail, ScanSummary, SurfaceSummary, VolumeRecord } from "@/lib/api";
import { fmtCoord, fmtCount, fmtLength, fmtVolume } from "@/lib/format";

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
  surfaces: SurfaceSummary[];
  hiddenSurfaceIds: Set<string>;
  selectedSurfaceId: string | null;
  onSelectSurface: (id: string | null) => void;
  onToggleSurfaceVisible: (id: string) => void;
  onDeleteSurface: (id: string) => void;
  onBuildSurface: (scanId: string, cellSize: number, aggregation: "mean" | "min" | "max") => Promise<void>;
  volumes: VolumeRecord[];
  selectedVolumeId: string | null;
  onSelectVolume: (id: string | null) => void;
  onDeleteVolume: (id: string) => void;
  sections: CrossSectionRecord[];
  selectedSectionId: string | null;
  onSelectSection: (id: string | null) => void;
  onDeleteSection: (id: string) => void;
}

function Item(props: {
  selected: boolean;
  title: string;
  subtitle: React.ReactNode;
  onSelect: () => void;
  onDelete: () => void;
  testId?: string;
  leading?: React.ReactNode;
}) {
  return (
    <li className={`group flex items-center gap-2 px-3 py-1 ${props.selected ? "bg-sky-900/40" : "hover:bg-slate-900"}`}>
      {props.leading}
      <button className="min-w-0 flex-1 text-left" onClick={props.onSelect} data-testid={props.testId}>
        <div className="truncate text-slate-100">{props.title}</div>
        <div className="text-[11px] tabular-nums text-slate-400">{props.subtitle}</div>
      </button>
      <button onClick={props.onDelete} className="invisible text-xs text-slate-500 hover:text-red-400 group-hover:visible" aria-label={`Delete ${props.title}`}>
        ✕
      </button>
    </li>
  );
}

/** Suggest a DEM cell size from point density: ~1.25 × mean point spacing, rounded to a nice value. */
export function suggestCellSize(planarDensity: number | null | undefined): number {
  if (!planarDensity || planarDensity <= 0) return 1;
  const spacing = 1 / Math.sqrt(planarDensity);
  const nice = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 50];
  return nice.find((v) => v >= spacing * 1.25) ?? 50;
}

function SurfaceBuilder({ scan, onBuild }: { scan: ScanDetail; onBuild: Props["onBuildSurface"] }) {
  const [cellSize, setCellSize] = useState(String(suggestCellSize(scan.pointCloud?.statistics.planarDensity)));
  const [aggregation, setAggregation] = useState<"mean" | "min" | "max">("mean");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-3 mb-1 mt-1 rounded border border-slate-800 p-2 text-[11px]" data-testid="surface-builder">
      <div className="mb-1 text-slate-400">Build surface from “{scan.name}”</div>
      <div className="flex gap-1">
        <label className="flex-1 text-slate-500">
          Cell ({scan.units})
          <input value={cellSize} onChange={(e) => setCellSize(e.target.value)} inputMode="decimal" className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-white" data-testid="surface-cell-size" />
        </label>
        <label className="flex-1 text-slate-500">
          Cell value
          <select value={aggregation} onChange={(e) => setAggregation(e.target.value as "mean" | "min" | "max")} className="w-full rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-white">
            <option value="mean">mean</option>
            <option value="min">min (ground)</option>
            <option value="max">max</option>
          </select>
        </label>
      </div>
      <button
        disabled={busy || !(Number(cellSize) > 0)}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await onBuild(scan.id, Number(cellSize), aggregation);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
        className="mt-1 w-full rounded bg-slate-700 py-1 font-medium text-white hover:bg-slate-600 disabled:opacity-50"
        data-testid="build-surface"
      >
        {busy ? "Building…" : "Build DEM surface"}
      </button>
      {error && <p className="mt-1 text-red-400" role="alert">{error}</p>}
    </div>
  );
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

      <Section title="Surfaces" count={p.surfaces.length}>
        {p.surfaces.length === 0 && !p.selectedScanDetail?.pointCloud && (
          <p className="px-3 text-xs text-slate-500">Select a scan to build a DEM surface.</p>
        )}
        <ul data-testid="surface-list">
          {p.surfaces.map((s) => (
            <Item
              key={s.id}
              selected={p.selectedSurfaceId === s.id}
              title={s.name}
              subtitle={`${s.cols}×${s.rows} @ ${s.cellSize} ${s.units} · Z ${s.zMin?.toFixed(2)}–${s.zMax?.toFixed(2)}`}
              onSelect={() => p.onSelectSurface(p.selectedSurfaceId === s.id ? null : s.id)}
              onDelete={() => {
                if (confirm(`Delete surface “${s.name}”?`)) p.onDeleteSurface(s.id);
              }}
              leading={
                <input
                  type="checkbox"
                  checked={!p.hiddenSurfaceIds.has(s.id)}
                  onChange={() => p.onToggleSurfaceVisible(s.id)}
                  className="accent-sky-500"
                  aria-label={`Show ${s.name}`}
                />
              }
            />
          ))}
        </ul>
        {p.selectedScanDetail?.pointCloud && <SurfaceBuilder key={p.selectedScanDetail.id} scan={p.selectedScanDetail} onBuild={p.onBuildSurface} />}
        <p className="px-3 text-[10px] text-slate-600">
          TIN surfaces, ground classification <span className="badge-planned">Planned</span>
        </p>
      </Section>

      <Section title="Volumes" count={p.volumes.length}>
        {p.volumes.length === 0 && <p className="px-3 text-xs text-slate-500">Use “Volume” in the toolbar.</p>}
        <ul data-testid="volume-list">
          {p.volumes.map((v) => (
            <Item
              key={v.id}
              selected={p.selectedVolumeId === v.id}
              title={v.name}
              subtitle={`↑ ${fmtVolume(v.volumeAbove, v.units)} · ↓ ${fmtVolume(v.volumeBelow, v.units)}`}
              onSelect={() => p.onSelectVolume(p.selectedVolumeId === v.id ? null : v.id)}
              onDelete={() => p.onDeleteVolume(v.id)}
            />
          ))}
        </ul>
      </Section>

      <Section title="Cross sections" count={p.sections.length}>
        {p.sections.length === 0 && <p className="px-3 text-xs text-slate-500">Use “Cross section” in the toolbar.</p>}
        <ul data-testid="section-list">
          {p.sections.map((c) => (
            <Item
              key={c.id}
              selected={p.selectedSectionId === c.id}
              title={c.name}
              subtitle={fmtLength(c.length ?? 0, c.units, 2)}
              onSelect={() => p.onSelectSection(p.selectedSectionId === c.id ? null : c.id)}
              onDelete={() => p.onDeleteSection(c.id)}
            />
          ))}
        </ul>
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
