from massefelt_worker.handlers import build_registry
from massefelt_worker.handlers.photogrammetry import make_reconstruct_handler
from massefelt_worker.jobs import HandlerRegistry, Job, JobResult
from massefelt_worker.photogrammetry import PIPELINE_STAGES, PhotogrammetryEngine, PhotogrammetryResult
from massefelt_worker.photogrammetry.pipeline import next_stage
from massefelt_worker.runner import run_once


class FakeQueue:
    def __init__(self, jobs):
        self.jobs = list(jobs)
        self.completed = []
        self.failed = []
        self.progressed = []

    def claim(self, job_types):
        for j in self.jobs:
            if j.type in job_types:
                self.jobs.remove(j)
                return j
        return None

    def progress(self, job_id, fraction):
        self.progressed.append((job_id, fraction))

    def complete(self, job, result):
        self.completed.append((job, result))

    def fail(self, job, error, *, permanent):
        self.failed.append((job, error, permanent))


def make_job(job_type, input=None, scan_id="scan_1"):
    return Job(id="j1", type=job_type, project_id="p1", scan_id=scan_id, input=input or {}, attempts=1, max_attempts=3)


def test_healthcheck_round_trip():
    q = FakeQueue([make_job("system.healthcheck", {"echo": "hi"})])
    assert run_once(q, build_registry("none")) is True
    _job, result = q.completed[0]
    assert result.output["echo"] == "hi"
    assert run_once(q, build_registry("none")) is False


def test_reconstruct_without_engine_fails_permanently_and_never_fabricates_output():
    q = FakeQueue([make_job("photogrammetry.reconstruct", {"imageKeys": ["a.jpg", "b.jpg"]})])
    run_once(q, build_registry("none"))
    assert not q.completed
    _, error, permanent = q.failed[0]
    assert permanent is True
    assert "No photogrammetry engine is configured" in error


def test_reconstruct_validates_input():
    q = FakeQueue([make_job("photogrammetry.reconstruct", {"imageKeys": ["only-one.jpg"]})])
    run_once(q, build_registry("none"))
    assert q.failed[0][2] is True


def test_engine_is_replaceable():
    class FakeEngine(PhotogrammetryEngine):
        name = "fake"
        version = "1.2.3"

        def process(self, job, progress):
            progress(0.5, "halfway")
            return PhotogrammetryResult(
                point_cloud_key=f"projects/{job.project_id}/pc.mfpc", mesh_key=None, crs=None, units="m",
                engine=self.name, engine_version=self.version,
            )

    registry = HandlerRegistry()
    registry.register("photogrammetry.reconstruct", make_reconstruct_handler(FakeEngine))
    q = FakeQueue([make_job("photogrammetry.reconstruct", {"imageKeys": ["a.jpg", "b.jpg"]})])
    run_once(q, registry)
    _, result = q.completed[0]
    assert isinstance(result, JobResult)
    assert result.engine == "fake" and result.engine_version == "1.2.3"
    assert result.output["crs"] is None  # local frame is reported honestly
    assert q.progressed == [("j1", 0.5)]


def test_unexpected_errors_are_retryable():
    registry = HandlerRegistry()

    def boom(job, progress):
        raise RuntimeError("disk full")

    registry.register("x.boom", boom)
    q = FakeQueue([make_job("x.boom")])
    run_once(q, registry)
    _, error, permanent = q.failed[0]
    assert permanent is False and "disk full" in error


def test_pipeline_stage_order():
    assert PIPELINE_STAGES[0].job_type == "images.preprocess"
    assert next_stage("photogrammetry.reconstruct").job_type == "pointcloud.import.engine"
    assert next_stage("web.optimize") is None
