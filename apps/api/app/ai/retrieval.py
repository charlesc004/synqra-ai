import re
from dataclasses import asdict, dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.providers import embed
from app.core.config import settings
from app.core.security import Actor
from app.models import Chunk, Collection, Document
from app.shared.access import document_access


@dataclass
class Evidence:
    id: str
    document_id: str
    filename: str
    text: str
    page: int | None
    section: str | None
    score: float = 0
    rank: int = 0

    def public(self) -> dict[str, Any]:
        return asdict(self)


def reciprocal_rank_fusion(rankings: list[list[str]], constant: int = 60) -> list[tuple[str, float]]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, identifier in enumerate(dict.fromkeys(ranking), 1):
            scores[identifier] = scores.get(identifier, 0) + 1 / (constant + rank)
    return sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))


def lexical_rerank(evidence: list[Evidence], query: str) -> list[Evidence]:
    terms = set(re.findall(r"\w+", query.lower()))
    return sorted(
        evidence, key=lambda e: -(e.score + 0.005 * len(terms & set(re.findall(r"\w+", e.text.lower()))))
    )


async def retrieve(
    db: Session,
    actor: Actor,
    query: str,
    collection_id: str | None = None,
    document_ids: list[str] | None = None,
    k: int | None = None,
    mode: str = "hybrid",
) -> list[Evidence]:
    config = settings()
    conditions = [
        *document_access(actor),
        Document.status == "ready",
        Chunk.workspace_id == actor.workspace_id,
        Chunk.embedding_identity == config.embedding_identity,
        Chunk.index_version == Collection.index_version,
        Collection.embedding_identity == config.embedding_identity,
    ]
    if collection_id:
        conditions.append(Chunk.collection_id == collection_id)
    if document_ids:
        conditions.append(Chunk.document_id.in_(document_ids))
    statement = (
        select(Chunk, Document.filename)
        .join(Document, Chunk.document_id == Document.id)
        .join(Collection, Chunk.collection_id == Collection.id)
        .where(*conditions)
    )
    rankings: list[list[str]] = []
    evidence: dict[str, Evidence] = {}

    def collect(rows: Any) -> None:
        ranking: list[str] = []
        for chunk, filename in rows:
            evidence[chunk.id] = Evidence(
                chunk.id, chunk.document_id, filename, chunk.text, chunk.page, chunk.section
            )
            ranking.append(chunk.id)
        rankings.append(ranking)

    if mode in {"hybrid", "semantic"}:
        try:
            vector = (await embed([query]))[0]
        except ValueError as error:
            raise HTTPException(503, str(error)) from error
        # Similarity threshold prevents unrelated semantic candidates from automatically becoming evidence.
        distance = Chunk.embedding.cosine_distance(vector)
        collect(
            db.execute(statement.where(distance < 0.65).order_by(distance).limit(config.semantic_candidates))
        )
    if mode in {"hybrid", "keyword"}:
        tsquery = func.websearch_to_tsquery("english", query)
        collect(
            db.execute(
                statement.where(Chunk.search_vector.op("@@")(tsquery))
                .order_by(func.ts_rank_cd(Chunk.search_vector, tsquery).desc())
                .limit(config.keyword_candidates)
            )
        )
    fused: list[Evidence] = []
    for identifier, score in reciprocal_rank_fusion(rankings):
        item = evidence[identifier]
        item.score = score
        fused.append(item)
    if config.rerank:
        fused = lexical_rerank(fused, query)
    result = fused[: k or config.retrieval_k]
    for rank, item in enumerate(result, 1):
        item.rank = rank
    return result
