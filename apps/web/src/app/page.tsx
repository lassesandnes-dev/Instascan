import Link from "next/link";
import { describeCrs } from "@massefelt/shared";
import { CreateProjectForm } from "@/components/CreateProjectForm";
import { getCurrentUser } from "@/server/auth";
import { listProjects } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  const projects = await listProjects(user);
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Massefelt</h1>
          <p className="text-sm text-slate-400">3D scanning, terrain analysis and earthworks</p>
        </div>
        <span className="text-xs text-slate-500">Signed in as {user.email}</span>
      </header>

      <section className="mb-10 rounded-lg border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-300">New project</h2>
        <CreateProjectForm />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Projects</h2>
        {projects.length === 0 ? (
          <p className="text-sm text-slate-500">No projects yet. Create one above.</p>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800" data-testid="project-list">
            {projects.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-900">
                  <div>
                    <div className="font-medium text-white">{p.name}</div>
                    {p.description && <div className="text-sm text-slate-400">{p.description}</div>}
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div>{p.scanCount} scan{p.scanCount === 1 ? "" : "s"}</div>
                    <div>{describeCrs(p.defaultCrs)}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
