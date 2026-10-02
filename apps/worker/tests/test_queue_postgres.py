"""Queue tests against a real PostgreSQL database (skipped unless TEST_DATABASE_URL is set).

The schema must already be migrated (`pnpm test:integration` or `pnpm db:migrate` against the test DB).
"""

import os
import uuid

import pytest

psycopg = pytest.importorskip("psycopg")

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")

from massefelt_worker.jobs import JobResult
from massefelt_worker.queue import PostgresJobQueue


@pytest.fixture()
def conn():
    with psycopg.connect(URL.split("?")[0], autocommit=True) as c:
        suffix = uuid.uuid4().hex[:8]
        c.execute('INSERT INTO "User"(id, email) VALUES (%s, %s)', (f"u_{suffix}", f"{suffix}@test.local"))
        c.execute('INSERT INTO "Organization"(id, name, slug) VALUES (%s, %s, %s)', (f"o_{suffix}", "Org", f"org-{suffix}"))
        c.execute(
            'INSERT INTO "Project"(id, "organizationId", name, "createdById", "updatedAt") VALUES (%s, %s, %s, %s, now())',
            (f"p_{suffix}", f"o_{suffix}", "Queue test", f"u_{suffix}"),
        )
        c.project_id = f"p_{suffix}"  # type: ignore[attr-defined]
        yield c
        c.execute('DELETE FROM "Project" WHERE id = %s', (f"p_{suffix}",))
        c.execute('DELETE FROM "Organization" WHERE id = %s', (f"o_{suffix}",))
        c.execute('DELETE FROM "User" WHERE id = %s', (f"u_{suffix}",))


def enqueue(conn, job_type, max_attempts=3):
    job_id = f"job_{uuid.uuid4().hex[:10]}"
    conn.execute(
        """INSERT INTO "ProcessingJob"(id, "projectId", type, executor, input, "maxAttempts")
           VALUES (%s, %s, %s, 'worker', '{"echo": 1}', %s)""",
        (job_id, conn.project_id, job_type, max_attempts),
    )
    return job_id


def status(conn, job_id):
    return conn.execute('SELECT status, attempts, error FROM "ProcessingJob" WHERE id = %s', (job_id,)).fetchone()


def test_claim_complete(conn):
    job_id = enqueue(conn, "test.ok")
    q = PostgresJobQueue(conn, "w1")
    job = q.claim(["test.ok"])
    assert job is not None and job.id == job_id and job.input == {"echo": 1}
    assert status(conn, job_id)[0] == "RUNNING"
    q.complete(job, JobResult(output={"done": True}, engine="t", engine_version="1"))
    assert status(conn, job_id)[0] == "SUCCEEDED"


def test_retry_then_permanent_failure(conn):
    job_id = enqueue(conn, "test.fail", max_attempts=2)
    q = PostgresJobQueue(conn, "w1")
    job = q.claim(["test.fail"])
    q.fail(job, "transient", permanent=False)
    assert status(conn, job_id)[:2] == ("QUEUED", 1)
    # Backoff: not claimable immediately.
    assert q.claim(["test.fail"]) is None
    conn.execute('UPDATE "ProcessingJob" SET "runAfter" = now() WHERE id = %s', (job_id,))
    job = q.claim(["test.fail"])
    q.fail(job, "still broken", permanent=False)
    assert status(conn, job_id)[0] == "FAILED"


def test_skip_locked_prevents_double_claim(conn):
    enqueue(conn, "test.concurrent")
    with psycopg.connect(URL.split("?")[0], autocommit=False) as other:
        other.execute(
            'SELECT id FROM "ProcessingJob" WHERE type = %s AND "projectId" = %s FOR UPDATE',
            ("test.concurrent", conn.project_id),
        )
        # Row is locked by another transaction: this worker skips it instead of blocking.
        assert PostgresJobQueue(conn, "w2").claim(["test.concurrent"]) is None
        other.rollback()
    assert PostgresJobQueue(conn, "w2").claim(["test.concurrent"]) is not None


def test_requeue_stale(conn):
    job_id = enqueue(conn, "test.stale")
    q = PostgresJobQueue(conn, "w1")
    q.claim(["test.stale"])
    conn.execute('UPDATE "ProcessingJob" SET "lockedAt" = now() - interval \'2 hours\' WHERE id = %s', (job_id,))
    assert q.requeue_stale(60) >= 1
    assert status(conn, job_id)[0] == "QUEUED"
