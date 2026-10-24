import asyncio
import json
from datetime import UTC, datetime, timedelta
from time import perf_counter
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.providers import ModelProvider
from app.ai.rag import (
    NO_EVIDENCE,
    CitationStreamGuard,
    messages_for,
    select_context,
    source_budget,
    validate_citations,
)
from app.ai.retrieval import retrieve
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import DB, Actor, ActorDep, rate_limit
from app.models import Collection, Conversation, Message, Usage
from app.shared.access import paginate, scoped

router = APIRouter(prefix="/conversations", tags=["Conversations"])


class ConversationBody(BaseModel):
    title: str = Field(default="New conversation", min_length=1, max_length=160)
    collection_id: str | None = None


def owned(db: Session, conversation_id: str, actor: Actor) -> Conversation:
    conversation = scoped(db, Conversation, conversation_id, actor)
    if conversation.owner_id != actor.user_id:
        raise HTTPException(404, "Conversation not found")
    return conversation


@router.get("")
def conversations(actor: ActorDep, db: DB, page: int = Query(1, ge=1)) -> dict[str, object]:
    rows = paginate(
        db,
        select(Conversation)
        .where(Conversation.workspace_id == actor.workspace_id, Conversation.owner_id == actor.user_id)
        .order_by(Conversation.created_at.desc()),
        page,
    )
    return {
        "items": [{"id": c.id, "title": c.title, "collection_id": c.collection_id} for c in rows[:30]],
        "has_more": len(rows) > 30,
    }


@router.post("", status_code=201)
def create_conversation(body: ConversationBody, actor: ActorDep, db: DB) -> dict[str, object]:
    if body.collection_id:
        scoped(db, Collection, body.collection_id, actor)
    conversation = Conversation(workspace_id=actor.workspace_id, owner_id=actor.user_id, **body.model_dump())
    db.add(conversation)
    db.commit()
    return {"id": conversation.id, "title": conversation.title, "collection_id": conversation.collection_id}


@router.get("/{conversation_id}")
def detail(conversation_id: str, actor: ActorDep, db: DB) -> dict[str, object]:
    conversation = owned(db, conversation_id, actor)
    messages = db.scalars(
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.created_at)
        .limit(500)
    )
    # Citation access is rechecked when opening the source; redacted private/deleted source metadata is not returned.
    from app.models import Document
    from app.shared.access import document_access

    allowed_ids = set(
        db.scalars(select(Document.id).where(*document_access(actor), Document.status != "deleted"))
    )
    return {
        "id": conversation.id,
        "title": conversation.title,
        "collection_id": conversation.collection_id,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "status": m.status,
                "citations": [c for c in m.citations if c.get("document_id") in allowed_ids],
            }
            for m in messages
        ],
    }


class ConversationPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    collection_id: str | None = None


@router.patch("/{conversation_id}")
def update(conversation_id: str, body: ConversationPatch, actor: ActorDep, db: DB) -> dict[str, str]:
    conversation = owned(db, conversation_id, actor)
    if "collection_id" in body.model_fields_set:
        if body.collection_id:
            scoped(db, Collection, body.collection_id, actor)
        conversation.collection_id = body.collection_id
    if body.title is not None:
        conversation.title = body.title
    db.commit()
    return {"status": "updated"}


@router.delete("/{conversation_id}")
def remove(conversation_id: str, actor: ActorDep, db: DB) -> dict[str, str]:
    conversation = owned(db, conversation_id, actor)
    db.delete(conversation)
    db.commit()
    return {"status": "deleted"}


class ChatBody(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    generation_id: UUID


def sse(event: str, payload: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


@router.post("/{conversation_id}/stream")
def stream(
    conversation_id: str, body: ChatBody, request: Request, actor: ActorDep, db: DB
) -> StreamingResponse:
    conversation = owned(db, conversation_id, actor)
    provider = ModelProvider()
    rate_limit(f"generation:{actor.user_id}", 20)
    db.refresh(conversation, with_for_update=True)
    generation_id = str(body.generation_id)
    if db.get(Message, generation_id):
        raise HTTPException(409, "This generation already exists; reload its saved state")
    active = db.scalar(
        select(Message).where(Message.conversation_id == conversation.id, Message.status == "streaming")
    )
    if active:
        if active.created_at > datetime.now(UTC) - timedelta(minutes=5):
            raise HTTPException(409, "A response is already generating")
        active.status = "interrupted"
    history = [
        (m.role, m.content)
        for m in reversed(
            list(
                db.scalars(
                    select(Message)
                    .where(Message.conversation_id == conversation.id, Message.status == "complete")
                    .order_by(Message.created_at.desc())
                    .limit(10)
                )
            )
        )
    ]
    db.add(Message(conversation_id=conversation.id, role="user", content=body.question))
    db.add(
        Message(
            id=generation_id,
            conversation_id=conversation.id,
            role="assistant",
            content="",
            status="streaming",
        )
    )
    if conversation.title == "New conversation":
        conversation.title = body.question[:80]
    collection_id = conversation.collection_id
    db.commit()

    async def generate():
        started = perf_counter()
        output, citations, state = "", [], "failed"
        retrieval_ms, chunk_count = 0.0, 0
        error_message = "Generation failed. Check the model connection and retry."
        yield sse("message_started", {"generation_id": generation_id})
        try:
            async with asyncio.timeout(180):
                with SessionLocal() as read_db:
                    evidence = select_context(
                        await retrieve(read_db, actor, body.question, collection_id),
                        source_budget(body.question),
                    )
                retrieval_ms = (perf_counter() - started) * 1000
                chunk_count = len(evidence)
                yield sse("retrieval_completed", {"count": chunk_count})
                if not evidence:
                    output = NO_EVIDENCE
                    yield sse("token_delta", {"delta": output})
                else:
                    guard = CitationStreamGuard(len(evidence))
                    async for delta in provider.stream(messages_for(body.question, evidence, history)):
                        if await request.is_disconnected():
                            raise asyncio.CancelledError()
                        safe = guard.push(delta)
                        output += safe
                        if len(output) > 18000:
                            raise ValueError("Model response exceeded the output limit")
                        if safe:
                            yield sse("token_delta", {"delta": safe})
                    tail = guard.push("", final=True)
                    output += tail
                    if tail:
                        yield sse("token_delta", {"delta": tail})
                    citations = validate_citations(output, evidence)
                state = "complete"
        except asyncio.CancelledError:
            state = "interrupted"
            raise
        except Exception as error:
            if isinstance(error, ValueError):
                error_message = str(error)[:300]
            elif isinstance(error, HTTPException):
                error_message = str(error.detail)
        finally:
            with SessionLocal() as write_db:
                message = write_db.get(Message, generation_id)
                if message:
                    message.content, message.status, message.citations = output, state, citations
                    message.usage = provider.usage
                    write_db.add(
                        Usage(
                            workspace_id=actor.workspace_id,
                            user_id=actor.user_id,
                            provider=settings().ai_provider,
                            model=settings().chat_model,
                            duration_ms=(perf_counter() - started) * 1000,
                            retrieval_ms=retrieval_ms,
                            chunks=chunk_count,
                            tokens=provider.usage.get("total_tokens"),
                            status=state,
                        )
                    )
                    write_db.commit()
        if state == "complete":
            yield sse("generation_completed", {"generation_id": generation_id, "citations": citations})
        else:
            yield sse("generation_failed", {"generation_id": generation_id, "error": error_message})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
