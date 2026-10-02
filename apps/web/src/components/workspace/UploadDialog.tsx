"use client";

import { useState } from "react";
import { DATA_SOURCES, INPUT_FORMATS } from "@massefelt/shared";
import { api } from "@/lib/api";

interface Props {
  projectId: string;
  defaultCrs: string | null;
  defaultVerticalDatum: string | null;
  onClose: () => void;
  onUploaded: (scanId: string) => void;
}

const field = "mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none";
const ACCEPT = INPUT_FORMATS.filter((f) => f.status === "supported").flatMap((f) => f.extensions).join(",");

export function UploadDialog({ projectId, defaultCrs, defaultVerticalDatum, onClose, onUploaded }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadScan(projectId, new FormData(e.currentTarget));
      onUploaded(res.scanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="Upload scan">
      <form onSubmit={onSubmit} className="w-[30rem] rounded-lg border border-slate-700 bg-slate-900 p-5 text-sm shadow-2xl">
        <h2 className="mb-1 text-base font-semibold text-white">Upload scan</h2>
        <p className="mb-4 text-xs text-slate-400">
          Coordinates are stored exactly as in the file. Declare the CRS and vertical datum if known — nothing is converted.
        </p>
        <label className="block text-xs text-slate-400">
          Point file *
          <input name="file" type="file" required accept={ACCEPT} className={`${field} file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-white`} data-testid="upload-file" />
        </label>
        <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-slate-500">
          {INPUT_FORMATS.map((f) => (
            <span key={f.id} className={f.status === "supported" ? "rounded bg-emerald-900/50 px-1.5 py-px text-emerald-300" : "rounded bg-slate-800 px-1.5 py-px"}>
              {f.label}
              {f.status === "planned" && " · Planned"}
            </span>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400">
            Name
            <input name="name" maxLength={200} className={field} placeholder="Defaults to filename" />
          </label>
          <label className="text-xs text-slate-400">
            Source
            <select name="source" defaultValue="file-import" className={field}>
              {DATA_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            CRS
            <input name="crs" defaultValue={defaultCrs ?? ""} maxLength={128} className={field} placeholder="Unknown" />
          </label>
          <label className="text-xs text-slate-400">
            Vertical datum
            <input name="verticalDatum" defaultValue={defaultVerticalDatum ?? ""} maxLength={128} className={field} placeholder="Unknown" />
          </label>
          <label className="text-xs text-slate-400">
            Units
            <select name="units" defaultValue="m" className={field}>
              {["m", "mm", "cm", "ft", "us-ft"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Acquisition date
            <input name="acquisitionDate" type="date" className={field} />
          </label>
        </div>
        {error && <p className="mt-3 text-red-400" role="alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-slate-300 hover:bg-slate-800">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="rounded bg-sky-600 px-4 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50" data-testid="upload-submit">
            {busy ? "Processing…" : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}
