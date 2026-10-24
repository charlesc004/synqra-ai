"""Clear only rate counters in the explicitly configured isolated test environment."""

from app.core.config import settings
from redis import Redis

config = settings()
if not config.test_mode:
    raise SystemExit("Refusing to reset counters outside TEST_MODE")
connection = Redis.from_url(config.redis_url)
keys = list(connection.scan_iter(match="rate:*"))
if keys:
    connection.unlink(*keys)
print(f"Cleared {len(keys)} test-only rate counters; queues and data were preserved.")
