"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeGrid, decodePointBuffer, elevationAt, type DemGrid } from "@massefelt/geometry";
import { describeCrs, describeVerticalDatum, type Vec3 } from "@massefelt/shared";
import type { ProjectSummary } from "@massefelt/tools";
import { AssistantPanel } from "@/components/ai/AssistantPanel";
import {
  api,
  type CrossSectionRecord,
  type MeasurementRecord,
  type ScanDetail,
  type ScanSummary,
  type SurfaceSummary,
  type VolumeRecord,
  type VolumeReferenceInput,
} from "@/lib/api";
import type { PickResult, PointCloudViewer, ViewerSettings } from "@/viewer/PointCloudViewer";
import { MeasurementPanel } from "./MeasurementPanel";
import { ProjectTree } from "./ProjectTree";
import { SectionPanel } from "./SectionPanel";
import { VolumePanel } from "./VolumePanel";
import { StatusBar } from "./StatusBar";
import { Toolbar, type ToolMode } from "./Toolbar";
import { UploadDialog } from "./UploadDialog";
import { Viewport } from "./Viewport";

interface Props {
  project: ProjectSummary;
  initialScans: ScanSummary[];
  initialMeasurements: MeasurementRecord[];
  initialSurfaces: SurfaceSummary[];
  initialVolumes: VolumeRecord[];
  initialSections: CrossSectionRecord[];
}

export function Workspace({ project, initialScans, initialMeasurements, initialSurfaces, initialVolumes, initialSections }: Props) {
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
  // Terrain (milestone 2)
  const [surfaces, setSurfaces] = useState(initialSurfaces);
  const [hiddenSurfaceIds, setHiddenSurfaceIds] = useState<Set<string>>(new Set());
  const [selectedSurfaceId, setSelectedSurfaceId] = useState<string | null>(initialSurfaces[0]?.id ?? null);
  const [volumes, setVolumes] = useState(initialVolumes);
  const [selectedVolumeId, setSelectedVolumeId] = useState<string | null>(null);
  const [sections, setSections] = useState(initialSections);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [polygon, setPolygon] = useState<Vec3[]>([]);
  const [polygonClosed, setPolygonClosed] = useState(false);
  const [sectionPts, setSectionPts] = useState<Vec3[]>([]);
  const [terrainSaving, setTerrainSaving] = useState(false);
  const [terrainError, setTerrainError] = useState<string | null>(null);
  const grids = useRef(new Map<string, DemGrid>());
  const [gridVersion, setGridVersion] = useState(0);
  // Latest values for the window key handler (registered once).
  const keyState = useRef({ tool: "navigate" as ToolMode, polygonClosed: false, polygonLength: 0 });
  useEffect(() => {
    keyState.current = { tool, polygonClosed, polygonLength: polygon.length };
  });
  const selectedVolume = volumes.find((v) => v.id === selectedVolumeId) ?? null;
  const selectedSection = sections.find((c) => c.id === selectedSectionId) ?? null;

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

  // Load surface grids into the viewer.
  useEffect(() => {
    if (!viewer) return;
    let cancelled = false;
    for (const s of surfaces) {
      if (viewer.hasSurface(s.id) || grids.current.has(s.id)) continue;
      grids.current.set(s.id, { originX: 0, originY: 0, cellSize: 1, cols: 0, rows: 0, z: new Float64Array() }); // placeholder while loading
      api
        .getSurfaceGrid(s.id)
        .then((buf) => {
          if (cancelled) return;
          const grid = decodeGrid(buf);
          grids.current.set(s.id, grid);
          viewer.addSurface(s.id, grid);
          viewer.setSurfaceVisible(s.id, !hiddenSurfaceIds.has(s.id));
          setGridVersion((v) => v + 1);
        })
        .catch((err) => {
          grids.current.delete(s.id);
          setMessage(`Could not load surface: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, surfaces]);

  useEffect(() => {
    if (!viewer) return;
    for (const s of surfaces) viewer.setSurfaceVisible(s.id, !hiddenSurfaceIds.has(s.id));
  }, [viewer, surfaces, hiddenSurfaceIds, gridVersion]);

  /** Give planimetric (XY) vertices a Z from a loaded surface for display. */
  const drape = useCallback(
    (pts: { x: number; y: number }[], surfaceId: string | null): Vec3[] => {
      const grid = surfaceId ? grids.current.get(surfaceId) : undefined;
      const fallback = surfaces.find((s) => s.id === surfaceId)?.zMax ?? 0;
      return pts.map((p) => {
        const z = grid && grid.cols ? elevationAt(grid, p.x, p.y) : NaN;
        return { x: p.x, y: p.y, z: Number.isNaN(z) ? fallback : z };
      });
    },
    [surfaces],
  );

  // Terrain overlays: boundary polygon and section line.
  useEffect(() => {
    if (!viewer) return;
    if (tool === "volume" && polygon.length) {
      viewer.showOverlay("polygon", polygon, { color: 0x34d399, closed: polygonClosed });
    } else if (tool !== "volume" && selectedVolume?.boundary) {
      viewer.showOverlay("polygon", drape(selectedVolume.boundary, selectedVolume.topSurfaceId), { color: 0x34d399, closed: true });
    } else viewer.clearOverlay("polygon");
    if (tool === "cross-section" && sectionPts.length) {
      viewer.showOverlay("section", sectionPts, { color: 0xa78bfa });
    } else if (tool !== "cross-section" && selectedSection) {
      viewer.showOverlay("section", drape(selectedSection.line, selectedSection.surfaceId), { color: 0xa78bfa });
    } else viewer.clearOverlay("section");
  }, [viewer, tool, polygon, polygonClosed, selectedVolume, sectionPts, selectedSection, drape, gridVersion, loadedCounts]);

  useEffect(() => viewer?.applySettings(settings), [viewer, settings]);
  useEffect(() => viewer?.setPickingEnabled(tool !== "navigate"), [viewer, tool]);
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
      const typing = e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
      if (e.key === "Escape") {
        setPending([]);
        setPolygon([]);
        setPolygonClosed(false);
        setSectionPts([]);
        setTool("navigate");
      } else if (!typing && keyState.current.tool === "volume" && !keyState.current.polygonClosed) {
        if (e.key === "Enter" && keyState.current.polygonLength >= 3) setPolygonClosed(true);
        if (e.key === "Backspace") setPolygon((pts) => pts.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onPick = useCallback(
    (pick: PickResult) => {
      if (tool === "measure-distance") {
        setSaveError(null);
        setSelectedMeasurementId(null);
        setPending((prev) => (prev.length >= 2 ? [pick] : [...prev, pick]));
      } else if (tool === "volume") {
        if (!polygonClosed) setPolygon((prev) => [...prev, pick.world]);
      } else if (tool === "cross-section") {
        setTerrainError(null);
        setSectionPts((prev) => (prev.length >= 2 ? [pick.world] : [...prev, pick.world]));
      }
    },
    [tool, polygonClosed],
  );

  function changeTool(t: ToolMode) {
    setTool(t);
    setPending([]);
    setPolygon([]);
    setPolygonClosed(false);
    setSectionPts([]);
    setTerrainError(null);
    if (t === "volume") setSelectedVolumeId(null);
    if (t === "cross-section") setSelectedSectionId(null);
  }

  async function buildSurface(scanId: string, cellSize: number, aggregation: "mean" | "min" | "max") {
    const { surface } = await api.buildSurface(scanId, { cellSize, aggregation });
    setSurfaces((prev) => [...prev, surface]);
    setSelectedSurfaceId(surface.id);
    setMessage(`Built ${surface.name}`);
  }

  async function deleteSurface(id: string) {
    await api.deleteSurface(id);
    viewer?.removeSurface(id);
    grids.current.delete(id);
    setSurfaces((prev) => prev.filter((s) => s.id !== id));
    if (selectedSurfaceId === id) setSelectedSurfaceId(null);
  }

  async function calculateVolume(input: { surfaceId: string; reference: VolumeReferenceInput; name?: string }) {
    setTerrainSaving(true);
    setTerrainError(null);
    try {
      const { volume } = await api.createVolume(project.id, { ...input, boundary: polygon.map((p) => ({ x: p.x, y: p.y })) });
      setVolumes((prev) => [...prev, volume]);
      setTool("navigate");
      setPolygon([]);
      setPolygonClosed(false);
      setSelectedVolumeId(volume.id);
      setSelectedMeasurementId(null);
      setMessage(`Saved ${volume.name}`);
    } catch (err) {
      setTerrainError(err instanceof Error ? err.message : String(err));
    } finally {
      setTerrainSaving(false);
    }
  }

  async function createSection(input: { surfaceId: string; referenceSurfaceId: string | null }) {
    setTerrainSaving(true);
    setTerrainError(null);
    try {
      const { crossSection } = await api.createSection(project.id, { ...input, line: sectionPts.map((p) => ({ x: p.x, y: p.y })) });
      setSections((prev) => [...prev, crossSection]);
      setTool("navigate");
      setSectionPts([]);
      setSelectedSectionId(crossSection.id);
      setMessage(`Saved ${crossSection.name}`);
    } catch (err) {
      setTerrainError(err instanceof Error ? err.message : String(err));
    } finally {
      setTerrainSaving(false);
    }
  }

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
    tool === "volume"
      ? polygonClosed
        ? "Volume: choose surface and reference, then calculate"
        : "Volume: click boundary points · Enter closes · Backspace undoes · Esc cancels"
      : tool === "cross-section"
        ? "Cross section: click start and end points"
        : tool === "measure-distance"
      ? pending.length === 0
        ? "Measure: click the first point (Esc to cancel)"
        : pending.length === 1
          ? "Measure: click the second point"
          : "Measure: save, or click to start a new measurement"
      : "Orbit: left-drag · Pan: right-drag · Zoom: wheel";
  const volumeUnits = surfaces.find((s) => s.id === selectedSurfaceId)?.units ?? units;

  return (
    <div className="flex h-screen flex-col">
      <Toolbar
        projectName={project.name}
        tool={tool}
        onToolChange={changeTool}
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
            surfaces={surfaces}
            hiddenSurfaceIds={hiddenSurfaceIds}
            selectedSurfaceId={selectedSurfaceId}
            onSelectSurface={setSelectedSurfaceId}
            onToggleSurfaceVisible={(id) =>
              setHiddenSurfaceIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onDeleteSurface={(id) => void deleteSurface(id).catch((e) => setMessage(String(e.message ?? e)))}
            onBuildSurface={buildSurface}
            volumes={volumes}
            selectedVolumeId={selectedVolumeId}
            onSelectVolume={(id) => {
              if (tool === "volume") changeTool("navigate");
              setSelectedVolumeId(id);
            }}
            onDeleteVolume={(id) =>
              void api
                .deleteVolume(id)
                .then(() => {
                  setVolumes((prev) => prev.filter((v) => v.id !== id));
                  if (selectedVolumeId === id) setSelectedVolumeId(null);
                })
                .catch((e) => setMessage(String(e.message ?? e)))
            }
            sections={sections}
            selectedSectionId={selectedSectionId}
            onSelectSection={(id) => {
              if (tool === "cross-section") changeTool("navigate");
              setSelectedSectionId(id);
            }}
            onDeleteSection={(id) =>
              void api
                .deleteSection(id)
                .then(() => {
                  setSections((prev) => prev.filter((c) => c.id !== id));
                  if (selectedSectionId === id) setSelectedSectionId(null);
                })
                .catch((e) => setMessage(String(e.message ?? e)))
            }
          />
        </aside>
        <main className="relative min-w-0 flex-1">
          <Viewport onReady={setViewer} onHover={onHover} onPick={onPick}>
            {tool === "volume" || selectedVolume ? (
              <VolumePanel
                key={selectedVolume?.id ?? "new"}
                boundary={tool === "volume" ? polygon : (selectedVolume?.boundary ?? [])}
                closed={tool === "volume" ? polygonClosed : true}
                surfaces={surfaces}
                defaultSurfaceId={selectedSurfaceId}
                units={selectedVolume?.units ?? volumeUnits}
                crsLabel={describeCrs(selectedVolume ? selectedVolume.crs : crs)}
                saving={terrainSaving}
                error={terrainError}
                volume={tool === "volume" ? null : selectedVolume}
                onClose={() => setPolygonClosed(true)}
                onUndo={() => setPolygon((pts) => pts.slice(0, -1))}
                onCalculate={calculateVolume}
                onClear={() => {
                  if (tool === "volume") changeTool("navigate");
                  setSelectedVolumeId(null);
                }}
              />
            ) : pending.length > 0 ? (
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
            {(tool === "cross-section" || selectedSection) && (
              <SectionPanel
                key={selectedSection?.id ?? "new"}
                pointCount={sectionPts.length}
                surfaces={surfaces}
                defaultSurfaceId={selectedSurfaceId}
                units={selectedSection?.units ?? volumeUnits}
                saving={terrainSaving}
                error={terrainError}
                section={tool === "cross-section" ? null : selectedSection}
                onCreate={createSection}
                onClear={() => {
                  if (tool === "cross-section") changeTool("navigate");
                  setSelectedSectionId(null);
                }}
              />
            )}
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
              selection={{
                scanId: selectedScanId,
                measurementId: selectedMeasurementId,
                objectIds: [],
                surfaceId: selectedSurfaceId,
                volumeId: selectedVolumeId,
              }}
              selectionLabel={[
                selectedScan ? `Scan: ${selectedScan.name}` : null,
                selectedMeasurement ? `Measurement: ${selectedMeasurement.name}` : null,
                selectedSurfaceId ? `Surface: ${surfaces.find((x) => x.id === selectedSurfaceId)?.name ?? ""}` : null,
                selectedVolume ? `Volume: ${selectedVolume.name}` : null,
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
