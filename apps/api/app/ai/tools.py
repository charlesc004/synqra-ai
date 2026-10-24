from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.retrieval import Evidence, retrieve
from app.core.security import Actor
from app.models import Action, Chunk
from app.modules.actions import action_public, execute_approved
from app.shared.access import accessible_document


class SearchKnowledge(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    collection_id: str | None = None


class DocumentExcerpt(BaseModel):
    document_id: str
    limit: int = Field(default=8, ge=1, le=12)


class CompareDocuments(BaseModel):
    document_ids: list[str] = Field(min_length=2, max_length=4)


class ListActions(BaseModel):
    status: Literal["open", "in_progress", "done"] | None = None


class ApprovedAction(BaseModel):
    approval_id: str


TOOL_SCHEMAS: dict[str, type[BaseModel]] = {
    "search_knowledge": SearchKnowledge,
    "get_document_excerpt": DocumentExcerpt,
    "compare_documents": CompareDocuments,
    "list_action_items": ListActions,
    "create_action_item": ApprovedAction,
}


async def call_tool(name: str, arguments: dict[str, object], db: Session, actor: Actor) -> Any:
    if name not in TOOL_SCHEMAS:
        raise ValueError("Unknown tool")
    parsed = TOOL_SCHEMAS[name].model_validate(arguments)
    if isinstance(parsed, SearchKnowledge):
        return await retrieve(db, actor, parsed.query, parsed.collection_id)
    if isinstance(parsed, DocumentExcerpt):
        document = accessible_document(db, parsed.document_id, actor)
        if document.status != "ready":
            return []
        return [
            Evidence(c.id, document.id, document.filename, c.text, c.page, c.section)
            for c in db.scalars(
                select(Chunk)
                .where(Chunk.document_id == document.id, Chunk.index_version == document.index_version)
                .order_by(Chunk.position)
                .limit(parsed.limit)
            )
        ]
    if isinstance(parsed, CompareDocuments):
        result: list[Evidence] = []
        for document_id in parsed.document_ids:
            result.extend(
                await call_tool("get_document_excerpt", {"document_id": document_id, "limit": 4}, db, actor)
            )
        return result
    if isinstance(parsed, ListActions):
        statement = select(Action).where(Action.workspace_id == actor.workspace_id)
        if parsed.status:
            statement = statement.where(Action.status == parsed.status)
        return [action_public(a) for a in db.scalars(statement.order_by(Action.created_at.desc()).limit(30))]
    assert isinstance(parsed, ApprovedAction)
    return action_public(execute_approved(db, actor, parsed.approval_id))
