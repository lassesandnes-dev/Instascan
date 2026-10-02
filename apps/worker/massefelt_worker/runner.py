from __future__ import annotations

import logging
import traceback
from typing import Protocol

from .jobs import HandlerRegistry, Job, JobResult, PermanentJobError

log = logging.getLogger("massefelt.worker")


class Queue(Protocol):
    def claim(self, job_types: list[str]) -> Job | None: ...
    def progress(self, job_id: str, fraction: float) -> None: ...
    def complete(self, job: Job, result: JobResult) -> None: ...
    def fail(self, job: Job, error: str, *, permanent: bool) -> None: ...


def run_once(queue: Queue, registry: HandlerRegistry) -> bool:
    """Claim and process at most one job. Returns True if a job was processed."""
    job = queue.claim(registry.job_types)
    if job is None:
        return False
    handler = registry.get(job.type)
    log.info("job claimed", extra={"job_id": job.id, "job_type": job.type, "attempt": job.attempts})
    try:
        if handler is None:
            raise PermanentJobError(f"No handler for job type {job.type}")
        result = handler(job, lambda fraction, _msg=None: queue.progress(job.id, fraction))
        queue.complete(job, result)
        log.info("job succeeded", extra={"job_id": job.id})
    except PermanentJobError as exc:
        log.warning("job failed permanently", extra={"job_id": job.id, "error": str(exc)})
        queue.fail(job, str(exc), permanent=True)
    except Exception as exc:  # noqa: BLE001 - any handler failure is recorded on the job
        log.error("job failed", extra={"job_id": job.id, "error": str(exc), "trace": traceback.format_exc()})
        queue.fail(job, f"{type(exc).__name__}: {exc}", permanent=False)
    return True
