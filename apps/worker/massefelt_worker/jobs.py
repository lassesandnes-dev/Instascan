from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class Job:
    id: str
    type: str
    project_id: str
    scan_id: str | None
    input: dict[str, Any]
    attempts: int
    max_attempts: int


@dataclass
class JobResult:
    output: dict[str, Any] = field(default_factory=dict)
    engine: str | None = None
    engine_version: str | None = None


class PermanentJobError(Exception):
    """Failure that must not be retried (bad input, unsupported configuration)."""


class ProgressReporter(Protocol):
    def __call__(self, fraction: float, message: str | None = None) -> None: ...


Handler = Callable[[Job, ProgressReporter], JobResult]


class HandlerRegistry:
    def __init__(self) -> None:
        self._handlers: dict[str, Handler] = {}

    def register(self, job_type: str, handler: Handler) -> None:
        if job_type in self._handlers:
            raise ValueError(f"Handler already registered for {job_type}")
        self._handlers[job_type] = handler

    def get(self, job_type: str) -> Handler | None:
        return self._handlers.get(job_type)

    @property
    def job_types(self) -> list[str]:
        return sorted(self._handlers)
