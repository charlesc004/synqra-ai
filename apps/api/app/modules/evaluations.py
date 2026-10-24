import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import DB, Actor, ActorDep
from app.jobs.queue import enqueue_evaluation
from app.models import Document, Evaluation
from app.shared.access import accessible_document, document_access, paginate, scoped

router = APIRouter(prefix="/evaluations", tags=["Evaluations"])


@router.get("/dataset")
def demo_dataset(actor: ActorDep, db: DB) -> dict[str, object]:
    actor.require("admin")
    path = Path(__file__).resolve().parents[4] / "datasets" / "evaluations" / "northstar.json"
    dataset = json.loads(path.read_text(encoding="utf-8"))
    documents = {
        d.filename: d.id
        for d in db.scalars(select(Document).where(*document_access(actor), Document.status != "deleted"))
    }
    cases = []
    missing: set[str] = set()
    for case in dataset["cases"]:
        absent = set(case["relevant_filenames"]) - documents.keys()
        if absent:
            missing.update(absent)
            continue
        cases.append(
            {
                "question": case["question"],
                "relevant_document_ids": [documents[name] for name in case["relevant_filenames"]],
            }
        )
    return {"name": dataset["name"], "cases": cases, "missing_filenames": sorted(missing)}


class Case(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    relevant_document_ids: list[str] = Field(max_length=10)


class EvaluationBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    k: int = Field(default=6, ge=1, le=20)
    mode: Literal["hybrid", "semantic", "keyword"] = "hybrid"
    cases: list[Case] = Field(min_length=1, max_length=100)


def public(run: Evaluation, detail: bool = False) -> dict[str, object]:
    return {
        "id": run.id,
        "status": run.status,
        "metrics": run.metrics,
        "configuration": run.configuration,
        "error": run.error,
        "created_at": run.created_at.isoformat(),
        "results": run.results if detail else [],
    }


def referenced_documents(run: Evaluation) -> set[str]:
    """Snapshots retain source text, so their read permissions must be checked again."""
    identifiers = {
        document_id
        for case in run.configuration.get("cases", [])
        for document_id in case.get("relevant_document_ids", [])
    }
    for result in run.results:
        identifiers.update(result.get("expected", []))
        identifiers.update(result.get("retrieved", []))
        identifiers.update(excerpt["document_id"] for excerpt in result.get("excerpts", []))
    return identifiers


def readable_documents(db: Session, actor: Actor) -> set[str]:
    return set(db.scalars(select(Document.id).where(*document_access(actor), Document.status != "deleted")))


@router.get("")
def evaluations(actor: ActorDep, db: DB, page: int = Query(1, ge=1)) -> dict[str, object]:
    actor.require("admin")
    rows = paginate(
        db,
        select(Evaluation)
        .where(Evaluation.workspace_id == actor.workspace_id)
        .order_by(Evaluation.created_at.desc()),
        page,
        20,
    )
    allowed = readable_documents(db, actor)
    return {
        "items": [public(r) for r in rows[:20] if referenced_documents(r) <= allowed],
        "has_more": len(rows) > 20,
    }


@router.post("/runs", status_code=201)
def start(body: EvaluationBody, actor: ActorDep, db: DB) -> dict[str, object]:
    actor.require("admin")
    for case in body.cases:
        for document_id in case.relevant_document_ids:
            accessible_document(db, document_id, actor)
    run = Evaluation(
        workspace_id=actor.workspace_id,
        configuration={
            **body.model_dump(),
            "embedding_identity": settings().embedding_identity,
            "rerank": settings().rerank,
            "semantic_candidates": settings().semantic_candidates,
            "keyword_candidates": settings().keyword_candidates,
        },
    )
    db.add(run)
    db.commit()
    try:
        enqueue_evaluation(run.id, actor.user_id)
    except Exception:
        run.status, run.error = "failed", "Queue unavailable. Check Redis."
        db.commit()
    return public(run)


@router.get("/runs/{run_id}")
@router.get("/runs/{run_id}/results")
def detail(run_id: str, actor: ActorDep, db: DB) -> dict[str, object]:
    actor.require("admin")
    run = scoped(db, Evaluation, run_id, actor)
    if not referenced_documents(run) <= readable_documents(db, actor):
        raise HTTPException(404, "Evaluation not found")
    return public(run, True)
