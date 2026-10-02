from __future__ import annotations

from ..jobs import HandlerRegistry
from ..photogrammetry import create_engine
from .healthcheck import healthcheck
from .photogrammetry import make_reconstruct_handler


def build_registry(photogrammetry_engine: str) -> HandlerRegistry:
    registry = HandlerRegistry()
    registry.register("system.healthcheck", healthcheck)
    registry.register("photogrammetry.reconstruct", make_reconstruct_handler(lambda: create_engine(photogrammetry_engine)))
    return registry
