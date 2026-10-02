import type { Database } from "./index";

/**
 * Job types. "inline" jobs run inside the web process (small, deterministic
 * work, recorded for provenance). "worker" jobs are picked up by the Python
 * worker (apps/worker) from the ProcessingJob table.
 */
export const JOB_TYPES = {
  xyzImport: "pointcloud.import.xyz",
  healthcheck: "system.healthcheck",
  imagesPreprocess: "images.preprocess",
  photogrammetryReconstruct: "photogrammetry.reconstruct",
  pointcloudImportEngine: "pointcloud.import.engine",
  meshBuild: "mesh.build",
  surfaceBuild: "surface.build",
  webOptimize: "web.optimize",
} as const;

export interface EnqueueJobInput {
  projectId: string;
  scanId?: string | null;
  type: string;
  input?: Record<string, unknown>;
  maxAttempts?: number;
  runAfter?: Date;
}

/** Queue a background job for the worker. Never run heavy processing inside an HTTP request. */
export function enqueueProcessingJob(db: Database, job: EnqueueJobInput) {
  return db.processingJob.create({
    data: {
      projectId: job.projectId,
      scanId: job.scanId ?? null,
      type: job.type,
      executor: "worker",
      status: "QUEUED",
      input: (job.input ?? {}) as object,
      maxAttempts: job.maxAttempts ?? 3,
      runAfter: job.runAfter ?? new Date(),
    },
  });
}
