"""Replaceable photogrammetry engine interface.

The platform is not coupled to a specific engine. Adapters for e.g.
COLMAP/OpenMVS, OpenDroneMap (NodeODM), Agisoft Metashape or RealityCapture
implement :class:`PhotogrammetryEngine` and are selected with the
``PHOTOGRAMMETRY_ENGINE`` environment variable.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field


@dataclass(frozen=True)
class PhotogrammetryJobSpec:
    """Engine-neutral description of a reconstruction job."""

    project_id: str
    scan_id: str
    #: Storage keys of the (pre-processed, perspective) input images.
    image_keys: list[str]
    #: Optional storage keys of ground control point / GNSS files.
    control_keys: list[str] = field(default_factory=list)
    #: Declared CRS of control data; ``None`` means a local, unscaled frame.
    crs: str | None = None
    vertical_datum: str | None = None
    quality: str = "medium"  # low | medium | high


@dataclass(frozen=True)
class PhotogrammetryResult:
    """Outputs written to object storage by the engine adapter."""

    point_cloud_key: str
    mesh_key: str | None
    #: Coordinate frame of the outputs. ``None`` = arbitrary local frame/scale
    #: (no georeferencing available). Never silently claimed to be a real CRS.
    crs: str | None
    units: str
    engine: str
    engine_version: str
    report: dict = field(default_factory=dict)


ProgressCallback = Callable[[float, str], None]


class PhotogrammetryEngine(ABC):
    name: str = "abstract"
    version: str = "0"

    @abstractmethod
    def process(self, job: PhotogrammetryJobSpec, progress: ProgressCallback) -> PhotogrammetryResult:
        """Run reconstruction. Must be deterministic for a given input + engine version where the engine allows."""


class EngineNotConfiguredError(Exception):
    pass


class NotConfiguredEngine(PhotogrammetryEngine):
    """Default engine: fails clearly instead of fabricating output."""

    name = "none"
    version = "0"

    def process(self, job: PhotogrammetryJobSpec, progress: ProgressCallback) -> PhotogrammetryResult:
        raise EngineNotConfiguredError(
            "No photogrammetry engine is configured (PHOTOGRAMMETRY_ENGINE=none). "
            "Photogrammetry processing is planned; see docs/photogrammetry-pipeline.md."
        )


_ENGINES: dict[str, type[PhotogrammetryEngine]] = {"none": NotConfiguredEngine}


def register_engine(name: str, engine: type[PhotogrammetryEngine]) -> None:
    _ENGINES[name] = engine


def create_engine(name: str) -> PhotogrammetryEngine:
    try:
        return _ENGINES[name]()
    except KeyError:
        raise EngineNotConfiguredError(f"Unknown photogrammetry engine: {name}") from None
