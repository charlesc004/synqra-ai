import asyncio
from time import perf_counter
from typing import Any, Literal, TypedDict

from fastapi import HTTPException
from langchain_core.messages import SystemMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.ai.providers import ModelProvider
from app.ai.rag import GROUNDING, messages_for, select_context, source_budget, validate_citations
from app.ai.retrieval import Evidence
from app.ai.tools import call_tool
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import Actor
from app.models import AgentRun, Approval, Audit, Membership, Usage, now
from app.modules.actions import ActionBody


class RunRequest(BaseModel):
    workflow: Literal["answer", "summarize", "compare", "extract", "action"]
    question: str = Field(min_length=1, max_length=2000)
    collection_id: str | None = None
    document_ids: list[str] = Field(default_factory=list, max_length=4)


class ProposedAction(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(max_length=4000)
    source_labels: list[str] = Field(min_length=1, max_length=10)


class Extraction(BaseModel):
    title: str | None = None
    organization: str | None = None
    summary: str
    important_dates: list[str]
    obligations: list[str]
    action_items: list[str]
    contacts: list[str]
    source_labels: list[str]


class Comparison(BaseModel):
    summary: str
    similarities: list[str]
    differences: list[str]
    conflicts: list[str]
    manual_review: list[str]
    source_labels: list[str]


class State(TypedDict, total=False):
    run_id: str
    evidence: list[dict[str, Any]]
    result: dict[str, Any]
    approval_id: str
    retrieval_ms: float


def event(run_id: str, tool: str, status: str, duration_ms: float = 0) -> None:
    with SessionLocal() as db:
        run = db.get(AgentRun, run_id)
        if run:
            run.events = [
                *run.events,
                {"tool": tool, "status": status, "duration_ms": round(duration_ms), "at": now().isoformat()},
            ]
            db.commit()


async def invoke_run(run_id: str, actor: Actor, resume: bool | None = None) -> dict[str, Any]:
    with SessionLocal() as db:
        run = db.get(AgentRun, run_id)
        if not run or run.workspace_id != actor.workspace_id or run.user_id != actor.user_id:
            raise HTTPException(404, "Run not found")
        request = RunRequest.model_validate(run.request)

    async def gather(state: State) -> State:
        event(run_id, "search_knowledge" if not request.document_ids else "get_document_excerpt", "started")
        started = perf_counter()
        with SessionLocal() as db:
            evidence: list[Evidence] = []
            if request.document_ids:
                for document_id in request.document_ids:
                    excerpts = await call_tool(
                        "get_document_excerpt", {"document_id": document_id, "limit": 4}, db, actor
                    )
                    if not excerpts:
                        raise ValueError("A selected document is not indexed or has no evidence")
                    evidence.extend(excerpts)
            else:
                query = request.question
                if settings().model_supports_tools:
                    from app.ai.tools import SearchKnowledge

                    arguments = await ModelProvider().search_tool_call(request.question)
                    query = SearchKnowledge.model_validate(arguments).query
                evidence = await call_tool(
                    "search_knowledge",
                    {"query": query, "collection_id": request.collection_id},
                    db,
                    actor,
                )
        selected = select_context(evidence, source_budget(request.question))
        if request.workflow == "compare" and {e.document_id for e in selected} != set(request.document_ids):
            raise ValueError(
                "Comparison context cannot cover every document. Select fewer or shorter documents."
            )
        if not selected:
            raise ValueError("No supporting evidence found. Index documents or broaden your selection.")
        retrieval_ms = (perf_counter() - started) * 1000
        event(run_id, "retrieve_evidence", "completed", retrieval_ms)
        return {"evidence": [e.public() for e in selected], "retrieval_ms": retrieval_ms}

    async def generate(state: State) -> State:
        evidence = [Evidence(**e) for e in state["evidence"]]
        provider = ModelProvider()
        messages = messages_for(request.question, evidence, [])
        event(run_id, request.workflow, "started")
        started = perf_counter()
        if request.workflow in {"action", "compare", "extract"}:
            schemas: dict[str, type[BaseModel]] = {
                "action": ProposedAction,
                "compare": Comparison,
                "extract": Extraction,
            }
            schema = schemas[request.workflow]
            messages[0] = SystemMessage(
                content=GROUNDING
                + " Return structured fields. Use null/empty lists for absent information. source_labels must name supporting sources such as S1. Do not infer dates or contacts."
            )
            structured = await provider.structured(messages, schema)
            result = structured.model_dump()
            labels = result.pop("source_labels", [])
            citations = validate_citations(" ".join(f"[{label}]" for label in labels), evidence)
            result["citations"] = citations
        else:
            text = ""
            async for delta in provider.stream(messages):
                text += delta
                if len(text) > 18000:
                    raise ValueError("Model output exceeded the limit")
            result = {"answer": text, "citations": validate_citations(text, evidence)}
        with SessionLocal() as db:
            db.add(
                Usage(
                    workspace_id=actor.workspace_id,
                    user_id=actor.user_id,
                    provider=settings().ai_provider,
                    model=settings().chat_model,
                    duration_ms=(perf_counter() - started) * 1000,
                    retrieval_ms=state.get("retrieval_ms", 0),
                    chunks=len(evidence),
                    tokens=provider.usage.get("total_tokens"),
                    status="complete",
                )
            )
            db.commit()
        event(run_id, request.workflow, "completed", (perf_counter() - started) * 1000)
        return {"result": result}

    async def approval(state: State) -> State:
        with SessionLocal() as db:
            pending = db.scalar(select(Approval).where(Approval.run_id == run_id))
            if not pending:
                proposal = ActionBody(
                    title=state["result"]["title"],
                    description=state["result"]["description"],
                    sources=list(dict.fromkeys(c["document_id"] for c in state["result"]["citations"])),
                )
                pending = Approval(
                    run_id=run_id, workspace_id=actor.workspace_id, proposal=proposal.model_dump(mode="json")
                )
                db.add(pending)
                db.flush()
                current = db.get(AgentRun, run_id)
                assert current
                current.status, current.result = "awaiting_approval", state["result"]
                db.commit()
            approval_id = pending.id
        accepted = interrupt({"approval_id": approval_id, "operation": "create_action_item"})
        if not accepted:
            return {"approval_id": approval_id, "result": {"status": "rejected"}}
        with SessionLocal() as db:
            # Reload role at execution time; revoked membership invalidates approval.
            membership = db.get(Membership, (actor.user_id, actor.workspace_id))
            if not membership:
                raise HTTPException(403, "Workspace access revoked")
            current_actor = Actor(actor.user_id, actor.workspace_id, membership.role)
            action = await call_tool("create_action_item", {"approval_id": approval_id}, db, current_actor)
            db.add(
                Audit(
                    workspace_id=actor.workspace_id,
                    actor_id=actor.user_id,
                    operation="tool.create_action_item",
                    resource_id=run_id,
                    details={"approval_id": approval_id},
                )
            )
            db.commit()
        event(run_id, "create_action_item", "completed")
        return {"approval_id": approval_id, "result": {"action": action}}

    builder = StateGraph(State)
    builder.add_node("retrieve", gather)
    builder.add_node("generate", generate)
    builder.add_node("approval", approval)
    builder.add_edge(START, "retrieve")
    builder.add_edge("retrieve", "generate")
    builder.add_edge("generate", "approval" if request.workflow == "action" else END)
    builder.add_edge("approval", END)
    connection = settings().database_url.replace("postgresql+psycopg://", "postgresql://")
    async with AsyncPostgresSaver.from_conn_string(connection) as saver:
        graph = builder.compile(checkpointer=saver)
        async with asyncio.timeout(180):
            output = await graph.ainvoke(
                Command(resume=resume) if resume is not None else {"run_id": run_id},
                config={
                    "configurable": {"thread_id": f"{actor.workspace_id}:{actor.user_id}:{run_id}"},
                    "recursion_limit": 8,
                },
            )
    with SessionLocal() as db:
        current = db.get(AgentRun, run_id)
        assert current
        if not output.get("__interrupt__"):
            current.status = (
                "rejected" if output.get("result", {}).get("status") == "rejected" else "completed"
            )
            current.result, current.completed_at = output.get("result", {}), now()
            db.commit()
    return output
