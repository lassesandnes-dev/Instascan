from __future__ import annotations

from collections.abc import Callable

from ..jobs import Job, JobResult, PermanentJobError, ProgressReporter
from ..photogrammetry import EngineNotConfiguredError, PhotogrammetryEngine, PhotogrammetryJobSpec


def make_reconstruct_handler(engine_factory: Callable[[], PhotogrammetryEngine]):
    def handle(job: Job, progress: ProgressReporter) -> JobResult:
        images = job.input.get("imageKeys")
        if not job.scan_id or not isinstance(images, list) or len(images) < 2:
            raise PermanentJobError("photogrammetry.reconstruct requires a scan and at least two image keys")
        spec = PhotogrammetryJobSpec(
            project_id=job.project_id,
            scan_id=job.scan_id,
            image_keys=[str(k) for k in images],
            control_keys=[str(k) for k in job.input.get("controlKeys", [])],
            crs=job.input.get("crs"),
            vertical_datum=job.input.get("verticalDatum"),
            quality=str(job.input.get("quality", "medium")),
        )
        try:
            engine = engine_factory()
            result = engine.process(spec, lambda f, _m="": progress(f))
        except EngineNotConfiguredError as exc:
            raise PermanentJobError(str(exc)) from exc
        return JobResult(
            output={
                "pointCloudKey": result.point_cloud_key,
                "meshKey": result.mesh_key,
                "crs": result.crs,
                "units": result.units,
                "report": result.report,
            },
            engine=result.engine,
            engine_version=result.engine_version,
        )

    return handle
