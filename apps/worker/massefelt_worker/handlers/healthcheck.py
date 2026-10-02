from __future__ import annotations

import platform

from .. import __version__
from ..jobs import Job, JobResult, ProgressReporter


def healthcheck(job: Job, progress: ProgressReporter) -> JobResult:
    """Round-trip job used to verify queue wiring end to end."""
    progress(1.0)
    return JobResult(
        output={"worker_version": __version__, "python": platform.python_version(), "echo": job.input.get("echo")},
        engine="healthcheck",
        engine_version=__version__,
    )
