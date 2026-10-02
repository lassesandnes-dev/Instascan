from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    worker_id: str
    poll_interval_seconds: float
    photogrammetry_engine: str
    stale_lock_minutes: int

    @staticmethod
    def from_env() -> WorkerConfig:
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL is required")
        return WorkerConfig(
            database_url=url,
            worker_id=os.environ.get("WORKER_ID", f"worker-{os.getpid()}"),
            poll_interval_seconds=float(os.environ.get("WORKER_POLL_INTERVAL_SECONDS", "2")),
            photogrammetry_engine=os.environ.get("PHOTOGRAMMETRY_ENGINE", "none"),
            stale_lock_minutes=int(os.environ.get("WORKER_STALE_LOCK_MINUTES", "60")),
        )
