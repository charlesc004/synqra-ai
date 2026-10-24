from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import DB, Actor, ActorDep
from app.models import Action, Approval, Membership, now
from app.shared.access import accessible_document, audit, paginate, scoped

router = APIRouter(prefix="/actions", tags=["Action items"])


class ActionBody(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=4000)
    due_date: date | None = None
    assignee_id: str | None = None
    sources: list[str] = Field(default_factory=list, max_length=10)


def validate_action(db: Session, actor: Actor, body: ActionBody) -> None:
    actor.require("write")
    for document_id in body.sources:
        accessible_document(db, document_id, actor)
    if body.assignee_id and not db.get(Membership, (body.assignee_id, actor.workspace_id)):
        raise HTTPException(422, "Assignee must belong to this workspace")


def action_public(action: Action) -> dict[str, object]:
    return {
        "id": action.id,
        "title": action.title,
        "description": action.description,
        "status": action.status,
        "due_date": action.due_date,
        "assignee_id": action.assignee_id,
        "sources": action.sources,
        "created_by": action.created_by,
        "created_at": action.created_at.isoformat(),
    }


def create_action(db: Session, actor: Actor, body: ActionBody, approval_id: str | None = None) -> Action:
    validate_action(db, actor, body)
    action = Action(
        workspace_id=actor.workspace_id,
        created_by=actor.user_id,
        approval_id=approval_id,
        **body.model_dump(mode="json"),
    )
    db.add(action)
    db.flush()
    audit(db, actor, "action.create", action.id, approval_id=approval_id)
    return action


def execute_approved(db: Session, actor: Actor, approval_id: str) -> Action:
    actor.require("write")
    approval = db.scalar(
        select(Approval)
        .where(Approval.id == approval_id, Approval.workspace_id == actor.workspace_id)
        .with_for_update()
    )
    if not approval or approval.status != "approved" or not approval.decided_by:
        raise HTTPException(409, "An authorized approval is required")
    action = db.scalar(select(Action).where(Action.approval_id == approval.id))
    if action:
        return action
    return create_action(db, actor, ActionBody.model_validate(approval.proposal), approval.id)


def decide(db: Session, actor: Actor, approval_id: str, approve: bool) -> Approval:
    actor.require("write")
    approval = db.scalar(
        select(Approval)
        .where(Approval.id == approval_id, Approval.workspace_id == actor.workspace_id)
        .with_for_update()
    )
    if not approval:
        raise HTTPException(404, "Approval not found")
    decision = "approved" if approve else "rejected"
    if approval.status != "pending":
        if approval.status == decision:
            return approval
        raise HTTPException(409, "This proposal already has a decision")
    if approve:
        validate_action(db, actor, ActionBody.model_validate(approval.proposal))
    approval.status, approval.decided_by, approval.decided_at = decision, actor.user_id, now()
    audit(db, actor, f"approval.{decision}", approval.id)
    db.commit()
    return approval


@router.get("")
def actions(actor: ActorDep, db: DB, page: int = Query(1, ge=1)) -> dict[str, object]:
    rows = paginate(
        db,
        select(Action).where(Action.workspace_id == actor.workspace_id).order_by(Action.created_at.desc()),
        page,
    )
    return {"items": [action_public(a) for a in rows[:30]], "has_more": len(rows) > 30}


@router.post("", status_code=201)
def add_action(body: ActionBody, actor: ActorDep, db: DB) -> dict[str, object]:
    # Explicit human submission. Agent callers can only reach execute_approved.
    action = create_action(db, actor, body)
    db.commit()
    return action_public(action)


class ActionPatch(BaseModel):
    status: Literal["open", "in_progress", "done"]


@router.patch("/{action_id}")
def patch_action(action_id: str, body: ActionPatch, actor: ActorDep, db: DB) -> dict[str, object]:
    actor.require("write")
    action = scoped(db, Action, action_id, actor)
    if action.created_by != actor.user_id and action.assignee_id != actor.user_id:
        actor.require("admin")
    action.status = body.status
    audit(db, actor, "action.status", action.id, status=body.status)
    db.commit()
    return action_public(action)
