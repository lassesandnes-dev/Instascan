"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

const input = "w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none";

export function CreateProjectForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.createProject({
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        defaultCrs: String(form.get("defaultCrs") ?? ""),
        defaultVerticalDatum: String(form.get("defaultVerticalDatum") ?? ""),
      });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" aria-label="Create project">
      <label className="text-xs text-slate-400">
        Name *
        <input name="name" required maxLength={120} className={input} placeholder="e.g. Byggefelt Nordre Ås" />
      </label>
      <label className="text-xs text-slate-400">
        Description
        <input name="description" maxLength={2000} className={input} placeholder="Optional" />
      </label>
      <label className="text-xs text-slate-400">
        Default CRS
        <input name="defaultCrs" maxLength={128} className={input} placeholder="e.g. EPSG:25832 (leave empty if unknown)" />
      </label>
      <label className="text-xs text-slate-400">
        Default vertical datum
        <input name="defaultVerticalDatum" maxLength={128} className={input} placeholder="e.g. NN2000 (leave empty if unknown)" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create project"}
        </button>
        {error && <span className="text-sm text-red-400" role="alert">{error}</span>}
      </div>
    </form>
  );
}
