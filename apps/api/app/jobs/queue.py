from redis import Redis
from rq import Queue, Retry

from app.core.config import settings


def enqueue_ingestion(document_id: str) -> str:
    from app.ai.ingestion import ingest

    job = Queue("ingestion", connection=Redis.from_url(settings().redis_url)).enqueue(
        ingest,
        document_id,
        job_timeout=600,
        retry=Retry(max=3, interval=[10, 30, 90]),
        result_ttl=3600,
        failure_ttl=86400,
    )
    return job.id


def enqueue_evaluation(evaluation_id: str, user_id: str) -> str:
    from app.ai.evaluation import run_evaluation

    job = Queue("ingestion", connection=Redis.from_url(settings().redis_url)).enqueue(
        run_evaluation, evaluation_id, user_id, job_timeout=600
    )
    return job.id
