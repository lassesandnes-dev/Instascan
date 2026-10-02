"use client";

import Link from "next/link";
import type { ViewerSettings } from "@/viewer/PointCloudViewer";

export type ToolMode = "navigate" | "measure-distance";

interface Props {
  projectName: string;
  tool: ToolMode;
  onToolChange: (tool: ToolMode) => void;
  settings: ViewerSettings;
  onSettingsChange: (s: ViewerSettings) => void;
  onResetView: () => void;
  onUpload: () => void;
  aiOpen: boolean;
  onToggleAI: () => void;
}

const btn = "rounded px-2.5 py-1.5 text-xs font-medium transition-colors";
const idle = `${btn} text-slate-200 hover:bg-slate-800`;
const active = `${btn} bg-sky-600 text-white`;

const PLANNED = ["Top view", "Section plane", "Polygon", "Cross section", "Volume", "Compare surfaces", "Place object", "Export"];

export function Toolbar(p: Props) {
  return (
    <div className="flex h-11 items-center gap-1 border-b border-slate-800 bg-slate-950 px-3 text-sm">
      <Link href="/" className="mr-2 font-semibold text-white hover:text-sky-300" title="All projects">
        Massefelt
      </Link>
      <span className="mr-3 max-w-56 truncate text-slate-400" title={p.projectName}>
        / {p.projectName}
      </span>

      <button className={idle} onClick={p.onUpload} data-testid="open-upload">
        Upload scan
      </button>
      <div className="mx-2 h-5 w-px bg-slate-800" />
      <button
        className={p.tool === "navigate" ? active : idle}
        onClick={() => p.onToolChange("navigate")}
        title="Orbit: left drag · Pan: right drag / shift+drag · Zoom: wheel"
      >
        Navigate
      </button>
      <button
        className={p.tool === "measure-distance" ? active : idle}
        onClick={() => p.onToolChange(p.tool === "measure-distance" ? "navigate" : "measure-distance")}
        data-testid="tool-measure"
        title="Click two points to measure (Esc to cancel)"
      >
        Measure distance
      </button>
      <button className={idle} onClick={p.onResetView} data-testid="reset-view">
        Reset view
      </button>
      <div className="mx-2 h-5 w-px bg-slate-800" />
      <label className="flex items-center gap-2 text-xs text-slate-300">
        Point size
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={p.settings.pointSize}
          onChange={(e) => p.onSettingsChange({ ...p.settings, pointSize: Number(e.target.value) })}
          className="w-20 accent-sky-500"
          aria-label="Point size"
        />
        <span className="w-6 tabular-nums">{p.settings.pointSize}</span>
      </label>
      <label className="ml-2 flex items-center gap-1 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={p.settings.showGrid}
          onChange={(e) => p.onSettingsChange({ ...p.settings, showGrid: e.target.checked })}
          className="accent-sky-500"
        />
        Grid
      </label>
      <label className="ml-2 flex items-center gap-1 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={p.settings.showAxes}
          onChange={(e) => p.onSettingsChange({ ...p.settings, showAxes: e.target.checked })}
          className="accent-sky-500"
        />
        Axes
      </label>

      <details className="relative ml-2">
        <summary className={`${idle} cursor-pointer list-none text-slate-400`}>Planned tools ▾</summary>
        <ul className="absolute left-0 z-20 mt-1 w-48 rounded border border-slate-700 bg-slate-900 p-1 shadow-xl">
          {PLANNED.map((name) => (
            <li key={name} className="flex items-center justify-between px-2 py-1 text-xs text-slate-500" aria-disabled="true">
              {name}
              <span className="badge-planned">Planned</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="flex-1" />
      <button className={p.aiOpen ? active : idle} onClick={p.onToggleAI} data-testid="toggle-ai">
        AI assistant
      </button>
    </div>
  );
}
