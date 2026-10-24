from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.agents import RunRequest, invoke_run
from app.ai.providers import ModelProvider
from app.core.security import DB, ActorDep, rate_limit
from app.models import AgentRun, Approval
from app.modules.actions import decide
from app.shared.access import paginate, scoped

router = APIRouter(prefix="/agents/runs", tags=["Agents"])


def run_public(run: AgentRun, approval: Approval | None) -> dict[str, object]:
    return {
        "id": run.id,
        "workflow": run.workflow,
        "status": run.status,
        "result": run.result,
        "events": run.events,
        "error": run.error,
        "request": run.request,
        "created_at": run.created_at.isoformat(),
        "approval": {"id": approval.id, "proposal": approval.proposal, "status": approval.status}
        if approval
        else None,
    }


def run_detail(run: AgentRun, db: Session) -> dict[str, object]:
    return run_public(run, db.scalar(select(Approval).where(Approval.run_id == run.id)))


def own_run(run_id: str, actor: ActorDep, db: DB) -> AgentRun:
    run = scoped(db, AgentRun, run_id, actor)
    if run.user_id != actor.user_id:
        raise HTTPException(404, "Run not found")
    return run


@router.get("")
def runs(actor: ActorDep, db: DB, page: int = Query(1, ge=1)) -> dict[str, object]:
    rows = paginate(
        db,
        select(AgentRun)
        .where(AgentRun.workspace_id == actor.workspace_id, AgentRun.user_id == actor.user_id)
        .order_by(AgentRun.created_at.desc()),
        page,
        20,
    )
    approvals = {
        approval.run_id: approval
        for approval in db.scalars(select(Approval).where(Approval.run_id.in_([run.id for run in rows[:20]])))
    }
    return {"items": [run_public(r, approvals.get(r.id)) for r in rows[:20]], "has_more": len(rows) > 20}


@router.post("", status_code=201)
async def start(body: RunRequest, actor: ActorDep, db: DB) -> dict[str, object]:
    ModelProvider()
    if body.workflow == "action":
        actor.require("write")
    if body.workflow == "compare" and len(set(body.document_ids)) < 2:
        raise HTTPException(422, "Select at least two distinct documents")
    if body.workflow in {"summarize", "extract"} and not body.document_ids:
        raise HTTPException(422, "Select a document for this workflow")
    rate_limit(f"agent:{actor.user_id}", 10)
    run = AgentRun(
        workspace_id=actor.workspace_id,
        user_id=actor.user_id,
        workflow=body.workflow,
        request=body.model_dump(),
    )
    db.add(run)
    db.commit()
    try:
        await invoke_run(run.id, actor)
    except Exception as error:
        db.refresh(run)
        run.status = "failed"
        run.error = (
            str(error)[:300]
            if isinstance(error, ValueError)
            else "Workflow failed. Verify model capabilities and server connectivity."
        )
        db.commit()
    db.refresh(run)
    return run_detail(run, db)


@router.get("/{run_id}")
@router.get("/{run_id}/events")
def detail(run_id: str, actor: ActorDep, db: DB) -> dict[str, object]:
    return run_detail(own_run(run_id, actor, db), db)


async def decision(run_id: str, actor: ActorDep, db: DB, approved: bool) -> dict[str, object]:
    run = own_run(run_id, actor, db)
    if run.status in {"completed", "rejected"}:
        return run_detail(run, db)
    approval = db.scalar(select(Approval).where(Approval.run_id == run.id))
    if not approval:
        raise HTTPException(409, "This run has no pending proposal")
    decide(db, actor, approval.id, approved)
    try:
        await invoke_run(run.id, actor, resume=approved)
    except Exception:
        # A committed decision remains durable. The same decision can be retried safely.
        raise HTTPException(
            503, "Decision saved. Resume failed; retry the same decision to continue safely."
        ) from None
    db.refresh(run)
    return run_detail(run, db)


@router.post("/{run_id}/approve")
async def approve(run_id: str, actor: ActorDep, db: DB) -> dict[str, object]:
    return await decision(run_id, actor, db, True)


@router.post("/{run_id}/reject")
async def reject(run_id: str, actor: ActorDep, db: DB) -> dict[str, object]:
    return await decision(run_id, actor, db, False)
