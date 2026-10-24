"""Bounded, dependency-aware readiness separate from process liveness."""

import asyncio
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Lock

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from redis import Redis
from redis.backoff import NoBackoff
from redis.exceptions import RedisError
from redis.retry import Retry
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings

router = APIRouter(tags=["Health"])
READINESS_TIMEOUT = 3.0
probe_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="readiness")
inflight: dict[str, Future[bool]] = {}
probe_lock = Lock()
# A separate small pool prevents saturated application connections from hanging probes.
probe_engine = create_engine(
    settings().database_url,
    pool_size=1,
    max_overflow=0,
    pool_timeout=2,
    pool_pre_ping=True,
    connect_args={
        "connect_timeout": 2,
        "options": "-c statement_timeout=2000",
        "tcp_user_timeout": 2000,
        "keepalives_idle": 2,
        "keepalives_interval": 1,
        "keepalives_count": 2,
    },
)


def database_ready() -> bool:
    try:
        with probe_engine.connect() as connection:
            return connection.scalar(text("SELECT 1")) == 1
    except (SQLAlchemyError, OSError):
        return False


def redis_ready() -> bool:
    try:
        with Redis.from_url(
            settings().redis_url,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry=Retry(NoBackoff(), 0),
        ) as connection:
            return bool(connection.ping())
    except (RedisError, OSError):
        return False


async def bounded_probe(name: str, check: Callable[[], bool]) -> bool:
    # OS DNS resolution can outlive socket timeouts. Reuse any running check so
    # timed-out HTTP requests cannot create an unbounded backlog of probe threads.
    with probe_lock:
        future = inflight.get(name)
        if future is None or future.done():
            future = probe_executor.submit(check)
            inflight[name] = future
    try:
        return await asyncio.wait_for(
            asyncio.shield(asyncio.wrap_future(future)), timeout=READINESS_TIMEOUT
        )
    except TimeoutError:
        return False


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "synqra-api"}


@router.get("/ready", responses={503: {"description": "Required dependency unavailable"}})
async def ready() -> JSONResponse:
    database, redis = await asyncio.gather(
        bounded_probe("database", database_ready), bounded_probe("redis", redis_ready)
    )
    dependencies = {"database": database, "redis": redis}
    available = all(dependencies.values())
    return JSONResponse(
        status_code=200 if available else 503,
        content={"status": "ready" if available else "unavailable", "dependencies": dependencies},
        headers={"Cache-Control": "no-store"},
    )
