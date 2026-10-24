"""Read-only evidence from the isolated running system-test stack."""

import json

from app.core.config import settings
from app.core.database import SessionLocal
from redis import Redis
from sqlalchemy import text

config = settings()
if not config.test_mode:
    raise SystemExit(
        "Use this verification script only with the isolated TEST_MODE stack"
    )
with SessionLocal() as db:
    evidence = {
        "postgresql": db.scalar(text("SHOW server_version")),
        "pgvector": db.scalar(
            text("SELECT extversion FROM pg_extension WHERE extname='vector'")
        ),
        "alembic_revision": db.scalar(text("SELECT version_num FROM alembic_version")),
        "documents": dict(
            db.execute(
                text("SELECT status, count(*) FROM documents GROUP BY status")
            ).all()
        ),
        "persisted_chunks": db.scalar(text("SELECT count(*) FROM chunks")),
        "embedding_dimensions": [
            row[0]
            for row in db.execute(
                text("SELECT DISTINCT vector_dims(embedding) FROM chunks")
            )
        ],
        "chunk_indexes": [
            row[0]
            for row in db.execute(
                text(
                    "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='chunks'"
                )
            )
        ],
        "persisted_checkpoints": db.scalar(text("SELECT count(*) FROM checkpoints")),
        "agent_statuses": dict(
            db.execute(
                text("SELECT status, count(*) FROM agent_runs GROUP BY status")
            ).all()
        ),
    }
connection = Redis.from_url(config.redis_url)
evidence["redis_ping"] = connection.ping()
evidence["ai_mode"] = "deterministic HTTP fixture; no live-provider quality claim"
print(json.dumps(evidence, indent=2))
