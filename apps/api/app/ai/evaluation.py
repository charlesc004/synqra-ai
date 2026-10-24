import asyncio
from time import perf_counter

from app.ai.retrieval import retrieve
from app.core.database import SessionLocal
from app.core.security import Actor
from app.models import Evaluation, Membership


def retrieval_metrics(retrieved: list[str], relevant: list[str], k: int) -> dict[str, float]:
    top = list(dict.fromkeys(retrieved))[:k]
    expected = set(relevant)
    hits = len(set(top) & expected)
    return {
        "precision_at_k": hits / k,
        "recall_at_k": hits / len(expected) if expected else 0.0,
        "mrr": next((1 / rank for rank, item in enumerate(top, 1) if item in expected), 0.0),
    }


def run_evaluation(evaluation_id: str, user_id: str) -> None:
    with SessionLocal() as db:
        run = db.get(Evaluation, evaluation_id)
        if not run:
            return
        membership = db.get(Membership, (user_id, run.workspace_id))
        if not membership or membership.role not in {"owner", "admin"}:
            run.status, run.error = "failed", "Evaluation permission revoked"
            db.commit()
            return
        actor = Actor(user_id, run.workspace_id, membership.role)
        run.status = "running"
        db.commit()
        results = []
        try:
            for case in run.configuration["cases"]:
                started = perf_counter()
                evidence = asyncio.run(
                    retrieve(
                        db, actor, case["question"], k=run.configuration["k"], mode=run.configuration["mode"]
                    )
                )
                retrieved = list(dict.fromkeys(e.document_id for e in evidence))
                metrics = retrieval_metrics(retrieved, case["relevant_document_ids"], run.configuration["k"])
                results.append(
                    {
                        "question": case["question"],
                        "expected": case["relevant_document_ids"],
                        "retrieved": retrieved,
                        **metrics,
                        "latency_ms": (perf_counter() - started) * 1000,
                        "unanswerable": not case["relevant_document_ids"],
                        "empty_retrieval": not evidence,
                        "excerpts": [e.public() for e in evidence],
                    }
                )
            answerable = [result for result in results if not result["unanswerable"]]
            run.metrics = {
                key: sum(result[key] for result in answerable) / len(answerable) if answerable else None
                for key in ["precision_at_k", "recall_at_k", "mrr"]
            }
            run.metrics["latency_ms"] = sum(r["latency_ms"] for r in results) / len(results)
            run.results, run.status = results, "completed"
            db.commit()
        except Exception:
            db.rollback()
            run = db.get(Evaluation, evaluation_id)
            assert run
            run.status, run.error = (
                "failed",
                "Evaluation failed. Verify indexing and embedding provider connectivity.",
            )
            db.commit()
            raise
