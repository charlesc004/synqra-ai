import asyncio
from threading import Event

import pytest
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.exc import OperationalError

from app.core import health
from app.main import app


@pytest.mark.parametrize("database,redis", [(True, True), (False, True), (True, False), (False, False)])
def test_readiness_requires_both_dependencies_without_affecting_liveness(monkeypatch, database, redis):
    monkeypatch.setattr(health, "database_ready", lambda: database)
    monkeypatch.setattr(health, "redis_ready", lambda: redis)
    with TestClient(app) as client:
        response = client.get("/api/v1/ready")
        assert response.status_code == (200 if database and redis else 503)
        assert response.json()["dependencies"] == {"database": database, "redis": redis}
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/api/v1/health").status_code == 200


def test_database_probe_handles_connection_failure(monkeypatch):
    def unavailable():
        raise OperationalError("SELECT 1", {}, Exception("secret connection details"))

    monkeypatch.setattr(health.probe_engine, "connect", unavailable)
    assert health.database_ready() is False


def test_redis_probe_handles_connection_failure(monkeypatch):
    def unavailable(*args, **kwargs):
        raise RedisConnectionError("secret redis credentials")

    monkeypatch.setattr(health.Redis, "from_url", unavailable)
    assert health.redis_ready() is False


def test_slow_probe_times_out_without_enqueuing_duplicate_checks(monkeypatch):
    release = Event()
    calls = []

    def stalled():
        calls.append(True)
        release.wait(5)
        return True

    async def requests():
        return await asyncio.gather(*(health.bounded_probe("test-stalled", stalled) for _ in range(8)))

    monkeypatch.setattr(health, "READINESS_TIMEOUT", 0.05)
    try:
        assert asyncio.run(requests()) == [False] * 8
        assert len(calls) == 1
    finally:
        release.set()
