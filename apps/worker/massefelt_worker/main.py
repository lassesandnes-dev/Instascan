from __future__ import annotations

import json
import logging
import signal
import sys
import time

import psycopg

from .config import WorkerConfig
from .handlers import build_registry
from .queue import PostgresJobQueue
from .runner import run_once


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = {"ts": self.formatTime(record), "level": record.levelname.lower(), "msg": record.getMessage(), "service": "worker"}
        for key in ("job_id", "job_type", "attempt", "error", "trace"):
            if hasattr(record, key):
                base[key] = getattr(record, key)
        return json.dumps(base)


def main() -> int:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler])
    log = logging.getLogger("massefelt.worker")

    cfg = WorkerConfig.from_env()
    registry = build_registry(cfg.photogrammetry_engine)
    stopping = False

    def stop(*_args: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    # Prisma-style URLs may carry ?schema=public, which libpq does not understand.
    url = cfg.database_url.split("?")[0]
    with psycopg.connect(url, autocommit=True) as conn:
        queue = PostgresJobQueue(conn, cfg.worker_id)
        log.info(f"worker started; job types: {', '.join(registry.job_types)}")
        last_reap = 0.0
        while not stopping:
            if time.monotonic() - last_reap > 60:
                requeued = queue.requeue_stale(cfg.stale_lock_minutes)
                if requeued:
                    log.warning(f"requeued {requeued} stale job(s)")
                last_reap = time.monotonic()
            if not run_once(queue, registry):
                time.sleep(cfg.poll_interval_seconds)
    log.info("worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
