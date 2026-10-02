"""Durable job queue on PostgreSQL (the ProcessingJob table).

Workers claim jobs with ``FOR UPDATE SKIP LOCKED`` so any number of worker
processes can run concurrently without double-processing. Failed jobs are
retried with exponential backoff up to ``maxAttempts``.
"""

from __future__ import annotations

import json
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .jobs import Job, JobResult

CLAIM_SQL = """
UPDATE "ProcessingJob" AS j
SET status = 'RUNNING', "lockedBy" = %(worker)s, "lockedAt" = now(),
    "startedAt" = COALESCE(j."startedAt", now()), attempts = j.attempts + 1
WHERE j.id = (
  SELECT id FROM "ProcessingJob"
  WHERE status = 'QUEUED' AND executor = 'worker' AND "runAfter" <= now() AND type = ANY(%(types)s)
  ORDER BY "createdAt"
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING j.id, j.type, j."projectId", j."scanId", j.input, j.attempts, j."maxAttempts"
"""


class PostgresJobQueue:
    def __init__(self, conn: psycopg.Connection[Any], worker_id: str) -> None:
        self.conn = conn
        self.worker_id = worker_id

    def claim(self, job_types: list[str]) -> Job | None:
        with self.conn.transaction(), self.conn.cursor(row_factory=dict_row) as cur:
            cur.execute(CLAIM_SQL, {"worker": self.worker_id, "types": job_types})
            row = cur.fetchone()
        if row is None:
            return None
        payload = row["input"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        return Job(
            id=row["id"],
            type=row["type"],
            project_id=row["projectId"],
            scan_id=row["scanId"],
            input=payload or {},
            attempts=row["attempts"],
            max_attempts=row["maxAttempts"],
        )

    def progress(self, job_id: str, fraction: float) -> None:
        with self.conn.transaction():
            self.conn.execute(
                'UPDATE "ProcessingJob" SET progress = %s, "lockedAt" = now() WHERE id = %s AND "lockedBy" = %s',
                (max(0.0, min(1.0, fraction)), job_id, self.worker_id),
            )

    def complete(self, job: Job, result: JobResult) -> None:
        with self.conn.transaction():
            self.conn.execute(
                """UPDATE "ProcessingJob" SET status = 'SUCCEEDED', progress = 1, output = %s, engine = %s,
                   "engineVersion" = %s, "finishedAt" = now(), "lockedBy" = NULL, "lockedAt" = NULL, error = NULL
                   WHERE id = %s""",
                (Jsonb(result.output), result.engine, result.engine_version, job.id),
            )

    def fail(self, job: Job, error: str, *, permanent: bool) -> None:
        retry = not permanent and job.attempts < job.max_attempts
        backoff_seconds = 30 * (2 ** (job.attempts - 1))
        with self.conn.transaction():
            if retry:
                self.conn.execute(
                    """UPDATE "ProcessingJob" SET status = 'QUEUED', error = %s, "lockedBy" = NULL, "lockedAt" = NULL,
                       "runAfter" = now() + make_interval(secs => %s) WHERE id = %s""",
                    (error[:4000], backoff_seconds, job.id),
                )
            else:
                self.conn.execute(
                    """UPDATE "ProcessingJob" SET status = 'FAILED', error = %s, "finishedAt" = now(),
                       "lockedBy" = NULL, "lockedAt" = NULL WHERE id = %s""",
                    (error[:4000], job.id),
                )

    def requeue_stale(self, stale_minutes: int) -> int:
        """Return jobs whose worker died (lock older than the threshold) to the queue."""
        with self.conn.transaction():
            cur = self.conn.execute(
                """UPDATE "ProcessingJob" SET status = 'QUEUED', "lockedBy" = NULL, "lockedAt" = NULL
                   WHERE status = 'RUNNING' AND executor = 'worker'
                   AND "lockedAt" < now() - make_interval(mins => %s)""",
                (stale_minutes,),
            )
            return cur.rowcount
