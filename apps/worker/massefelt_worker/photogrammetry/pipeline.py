"""Photogrammetry pipeline definition (designed; stages are implemented incrementally).

    X5 / phone / drone images
      -> preprocess   (de-duplicate, EXIF/GNSS extraction, 360° → perspective reprojection, masking)
      -> reconstruct  (PhotogrammetryEngine: SfM + MVS)
      -> pointcloud   (import engine output, statistics, provenance)
      -> mesh         (surface reconstruction / engine mesh import)
      -> surface      (ground classification, TIN / DEM grid)
      -> web          (MFPC / tiled LOD representation for the browser)

Each stage is a separate ProcessingJob type so stages can be retried and
re-run independently, and each produced asset records its parent asset.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PipelineStage:
    job_type: str
    description: str
    implemented: bool


PIPELINE_STAGES: tuple[PipelineStage, ...] = (
    PipelineStage("images.preprocess", "Validate images, extract EXIF/GNSS, reproject 360° equirectangular to perspective views", False),
    PipelineStage("photogrammetry.reconstruct", "Structure-from-motion + multi-view stereo via PhotogrammetryEngine", False),
    PipelineStage("pointcloud.import.engine", "Import engine point cloud, compute statistics, record provenance", False),
    PipelineStage("mesh.build", "Build or import a triangle mesh", False),
    PipelineStage("surface.build", "Ground filtering and TIN / DEM grid generation", False),
    PipelineStage("web.optimize", "Generate web-optimized (LOD/tiled) representation", False),
)


def next_stage(job_type: str) -> PipelineStage | None:
    types = [s.job_type for s in PIPELINE_STAGES]
    if job_type not in types:
        return None
    i = types.index(job_type)
    return PIPELINE_STAGES[i + 1] if i + 1 < len(PIPELINE_STAGES) else None
