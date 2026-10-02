"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodePointBuffer } from "@massefelt/geometry";
import { describeCrs, describeVerticalDatum, type Vec3 } from "@massefelt/shared";
import type { ProjectSummary } from "@massefelt/tools";
import { AssistantPanel } from "@/components/ai/AssistantPanel";
import { api, type MeasurementRecord, type ScanDetail, type ScanSummary } from "@/lib/api";
import type { PickResult, PointCloudViewer, ViewerSettings } from "@/viewer/PointCloudViewer";
import { MeasurementPanel } from "./MeasurementPanel";
import { ProjectTree } from "./ProjectTree";
import { StatusBar } from "./StatusBar";
import { Toolbar, type ToolMode } from "./Toolbar";
import { UploadDialog } from "./UploadDialog";
import { Viewport } from "./Viewport";

interface Props {
  project: ProjectSummary;
  initialScans: ScanSummary[];
  initialMeasurements: MeasurementRecord[];
}

export function Workspace({ project, initialScans, initialMeasurements }: Props) {
  const [viewer, setViewer] = useState<PointCloudViewer | null>(null);
  const [scans, setScans] = useState(initialScans);
  const [measurements, setMeasurements] = useState(initialMeasurements);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(initialScans.find((s) => s.status === "READY")?.id ?? null);
  const [selectedScanDetail, setSelectedScanDetail] = useState<ScanDetail | null>(null);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const [hiddenScanIds, setHiddenScanIds] = useState<Set<string>>(new Set());
  const [loadingScanIds, setLoadingScanIds] = useState<Set<string>>(new Set());
  const [loadedCounts, setLoadedCounts] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState<ViewerSettings>({ pointSize: 2, showGrid: true, showAxes: true });
  const [tool, setTool] = useState<ToolMode>("navigate");
  const [pending, setPending] = useState<PickResult[]>([]);
  const [hover, setHover] = useState<Vec3 | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const fittedOnce = useRef(false);

  const selectedMeasurement = measurements.find((m) => m.id === selectedMeasurementId) ?? null;
  const selectedScan = scans.find((s) => s.id === selectedScanId) ?? null;
  const crs = selectedScan ? selectedScan.crs : project.defaultCrs;
  const datum = selectedScan ? selectedScan.verticalDatum : project.defaultVerticalDatum;
  const units = selectedScan?.units ?? project.units;

  // Load every READY scan into the viewer once.
  useEffect(() => {
    if (!viewer) return;
    let cancelled = false;
    const toLoad = scans.filter((s) => s.status === "READY" && !viewer.hasPointCloud(s.id) && !loadingScanIds.has(s.id));
    if (toLoad.length === 0) return;
    setLoadingScanIds((prev) => new Set([...prev, ...toLoad.map((s) => s.id)]));
    Promise.all(
      toLoad.map(async (s) => {
        try {
          const decoded = decodePointBuffer(await api.getPointBuffer(s.id));
          if (cancelled) return;
          viewer.addPointCloud(s.id, decoded);
          setLoadedCounts((prev) => ({ ...prev, [s.id]: decoded.count }));
        } catch (err) {
          setMessage(`Could not load ${s.name}: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setLoadingScanIds((prev) => {
            const next = new Set(prev);
            next.delete(s.id);
            return next;
          });
        }
      }),
    ).then(() => {
      if (!cancelled && !fittedOnce.current) {
        fittedOnce.current = true;
        viewer.resetView();
      }
    });
    return () => {
      cancelled = true;
    };
    // loadingScanIds intentionally omitted: it is updated by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, scans]);

  useEffect(() => viewer?.applySettings(settings), [viewer, settings]);
  useEffect(() => viewer?.setPickingEnabled(tool === "measure-distance"), [viewer, tool]);
  useEffect(() => {
    if (!viewer) return;
    for (const s of scans) viewer.setCloudVisible(s.id, !hiddenScanIds.has(s.id));
  }, [viewer, scans, hiddenScanIds]);

  // Overlay: pending measurement wins over the selected saved one.
  useEffect(() => {
    if (!viewer) return;
    if (pending.length) viewer.showMeasurement(pending.map((p) => p.world));
    else if (selectedMeasurement) viewer.showMeasurement(selectedMeasurement.points);
    else viewer.clearMeasurement();
  }, [viewer, pending, selectedMeasurement, loadedCounts]);

  useEffect(() => {
    if (!selectedScanId) {
      setSelectedScanDetail(null);
      return;
    }
    let cancelled = false;
    api
      .getScan(selectedScanId)
      .then(({ scan }) => !cancelled && setSelectedScanDetail(scan))
      .catch(() => !cancelled && setSelectedScanDetail(null));
    return () => {
      cancelled = true;
    };
  }, [selectedScanId, scans]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPending([]);
        setTool("navigate");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onPick = useCallback(
    (pick: PickResult) => {
      if (tool !== "measure-distance") return;
      setSaveError(null);
      setSelectedMeasurementId(null);
      setPending((prev) => (prev.length >= 2 ? [pick] : [...prev, pick]));
    },
    [tool],
  );

  const onHover = useCallback((pick: PickResult | null) => setHover(pick?.world ?? null), []);

  async function refreshScans() {
    const { scans } = await api.listScans(project.id);
    setScans(scans);
    return scans;
  }

  async function saveMeasurement() {
    if (pending.length !== 2) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { measurement } = await api.createDistance(project.id, {
        scanId: pending[0]!.scanId,
        from: pending[0]!.world,
        to: pending[1]!.world,
      });
      setMeasurements((prev) => [...prev, measurement]);
      setSelectedMeasurementId(measurement.id);
      setPending([]);
      setMessage(`Saved ${measurement.name}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function deleteMeasurement(id: string) {
    await api.deleteMeasurement(id);
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
    if (selectedMeasurementId === id) setSelectedMeasurementId(null);
  }

  async function deleteScan(id: string) {
    await api.deleteScan(id);
    viewer?.removePointCloud(id);
    if (selectedScanId === id) setSelectedScanId(null);
    setPending((prev) => prev.filter((p) => p.scanId !== id));
    await refreshScans();
    const { measurements } = await api.listMeasurements(project.id);
    setMeasurements(measurements);
  }

  const visiblePoints = useMemo(
    () => Object.entries(loadedCounts).reduce((sum, [id, n]) => (hiddenScanIds.has(id) ? sum : sum + n), 0),
    [loadedCounts, hiddenScanIds],
  );

  const hint =
    tool === "measure-distance"
      ? pending.length === 0
        ? "Measure: click the first point (Esc to cancel)"
        : pending.length === 1
          ? "Measure: click the second point"
          : "Measure: save, or click to start a new measurement"
      : "Orbit: left-drag · Pan: right-drag · Zoom: wheel";

  return (
    <div className="flex h-screen flex-col">
      <Toolbar
        projectName={project.name}
        tool={tool}
        onToolChange={(t) => {
          setTool(t);
          if (t === "navigate") setPending([]);
        }}
        settings={settings}
        onSettingsChange={setSettings}
        onResetView={() => viewer?.resetView()}
        onUpload={() => setUploadOpen(true)}
        aiOpen={aiOpen}
        onToggleAI={() => setAiOpen((v) => !v)}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-950/80">
          <ProjectTree
            scans={scans}
            measurements={measurements}
            selectedScanId={selectedScanId}
            selectedMeasurementId={selectedMeasurementId}
            hiddenScanIds={hiddenScanIds}
            loadingScanIds={loadingScanIds}
            selectedScanDetail={selectedScanDetail}
            onSelectScan={setSelectedScanId}
            onToggleScanVisible={(id) =>
              setHiddenScanIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onDeleteScan={(id) => void deleteScan(id).catch((e) => setMessage(String(e.message ?? e)))}
            onSelectMeasurement={(id) => {
              setPending([]);
              setSelectedMeasurementId(id);
            }}
            onDeleteMeasurement={(id) => void deleteMeasurement(id).catch((e) => setMessage(String(e.message ?? e)))}
          />
        </aside>
        <main className="relative min-w-0 flex-1">
          <Viewport onReady={setViewer} onHover={onHover} onPick={onPick}>
            {pending.length > 0 ? (
              <MeasurementPanel
                title="New distance measurement"
                points={pending.map((p) => p.world)}
                units={units}
                crsLabel={describeCrs(crs)}
                saving={saving}
                error={saveError}
                onSave={pending.length === 2 ? saveMeasurement : undefined}
                onClear={() => setPending([])}
                hint={pending.length === 1 ? "Click a second point." : undefined}
              />
            ) : selectedMeasurement ? (
              <MeasurementPanel
                title={selectedMeasurement.name}
                points={selectedMeasurement.points}
                units={selectedMeasurement.units}
                crsLabel={describeCrs(selectedMeasurement.crs)}
                onClear={() => setSelectedMeasurementId(null)}
              />
            ) : null}
            {scans.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="pointer-events-auto rounded-lg border border-slate-700 bg-slate-900/90 p-6 text-center text-sm">
                  <p className="mb-3 text-slate-300">This project has no scans yet.</p>
                  <button onClick={() => setUploadOpen(true)} className="rounded bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500">
                    Upload an XYZ / CSV point file
                  </button>
                </div>
              </div>
            )}
          </Viewport>
        </main>
        {aiOpen && (
          <aside className="w-96 shrink-0 border-l border-slate-800 bg-slate-950/80">
            <AssistantPanel
              projectId={project.id}
              selection={{ scanId: selectedScanId, measurementId: selectedMeasurementId, objectIds: [] }}
              selectionLabel={[
                selectedScan ? `Scan: ${selectedScan.name}` : null,
                selectedMeasurement ? `Measurement: ${selectedMeasurement.name}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          </aside>
        )}
      </div>
      <StatusBar
        hover={hover}
        crsLabel={describeCrs(crs)}
        datumLabel={describeVerticalDatum(datum)}
        units={units}
        visiblePoints={visiblePoints}
        hint={hint}
        message={message}
      />
      {uploadOpen && (
        <UploadDialog
          projectId={project.id}
          defaultCrs={project.defaultCrs}
          defaultVerticalDatum={project.defaultVerticalDatum}
          onClose={() => setUploadOpen(false)}
          onUploaded={async (scanId) => {
            setUploadOpen(false);
            fittedOnce.current = false;
            await refreshScans();
            setSelectedScanId(scanId);
            setMessage("Scan imported");
          }}
        />
      )}
    </div>
  );
}
