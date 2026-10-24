from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select

from app.ai.providers import provider_health
from app.core.config import settings
from app.core.security import DB, ActorDep, UserDep
from app.models import Action, Audit, Collection, Conversation, Document, Membership, Usage, User, Workspace
from app.shared.access import audit, document_access, paginate

router = APIRouter(tags=["Workspace"])


class WorkspaceBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.get("/workspaces")
def workspaces(user: UserDep, db: DB) -> list[dict[str, str]]:
    return [
        {"id": w.id, "name": w.name, "role": m.role}
        for w, m in db.execute(
            select(Workspace, Membership)
            .join(Membership, Membership.workspace_id == Workspace.id)
            .where(Membership.user_id == user.id)
            .limit(100)
        )
    ]


@router.post("/workspaces", status_code=201)
def create_workspace(body: WorkspaceBody, user: UserDep, db: DB) -> dict[str, str]:
    workspace = Workspace(name=body.name)
    db.add(workspace)
    db.flush()
    db.add(Membership(user_id=user.id, workspace_id=workspace.id, role="owner"))
    db.add(
        Collection(
            workspace_id=workspace.id,
            name="General knowledge",
            embedding_identity=settings().embedding_identity,
        )
    )
    db.commit()
    return {"id": workspace.id, "name": workspace.name, "role": "owner"}


@router.get("/workspaces/{workspace_id}")
def workspace_detail(workspace_id: str, actor: ActorDep, db: DB) -> dict[str, str]:
    workspace = db.get(Workspace, workspace_id)
    if not workspace or workspace.id != actor.workspace_id:
        raise HTTPException(404, "Workspace not found")
    return {"id": workspace.id, "name": workspace.name, "role": actor.role}


@router.patch("/workspaces/{workspace_id}")
def update_workspace(workspace_id: str, body: WorkspaceBody, actor: ActorDep, db: DB) -> dict[str, str]:
    actor.require("admin")
    if workspace_id != actor.workspace_id:
        raise HTTPException(404, "Workspace not found")
    workspace = db.get(Workspace, workspace_id)
    assert workspace
    workspace.name = body.name
    audit(db, actor, "workspace.update", workspace.id)
    db.commit()
    return {"id": workspace.id, "name": workspace.name}


@router.get("/workspaces/{workspace_id}/members")
def members(workspace_id: str, actor: ActorDep, db: DB) -> list[dict[str, str]]:
    actor.require("admin")
    if workspace_id != actor.workspace_id:
        raise HTTPException(404, "Workspace not found")
    return [
        {"id": u.id, "name": u.name, "email": u.email, "role": m.role}
        for u, m in db.execute(
            select(User, Membership)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.workspace_id == workspace_id)
            .limit(200)
        )
    ]


class MemberBody(BaseModel):
    email: EmailStr
    role: Literal["admin", "member", "viewer"]


@router.post("/workspaces/{workspace_id}/members")
def add_member(workspace_id: str, body: MemberBody, actor: ActorDep, db: DB) -> dict[str, str]:
    actor.require("admin")
    if workspace_id != actor.workspace_id:
        raise HTTPException(404, "Workspace not found")
    if body.role == "admin" and actor.role != "owner":
        raise HTTPException(403, "Only an owner can grant administrator access")
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user:
        raise HTTPException(404, "Ask this person to register first")
    membership = db.get(Membership, (user.id, workspace_id))
    if membership:
        if membership.role == "owner" or (membership.role == "admin" and actor.role != "owner"):
            raise HTTPException(403, "This membership can only be changed by its owner")
        membership.role = body.role
    else:
        db.add(Membership(user_id=user.id, workspace_id=workspace_id, role=body.role))
    audit(db, actor, "membership.update", user.id, role=body.role)
    db.commit()
    return {"status": "updated"}


@router.get("/providers/status")
async def status(actor: ActorDep) -> dict[str, object]:
    return await provider_health()


@router.get("/dashboard")
def dashboard(actor: ActorDep, db: DB) -> dict[str, object]:
    documents = db.execute(
        select(Document.status, func.count())
        .where(*document_access(actor), Document.status != "deleted")
        .group_by(Document.status)
    ).all()
    return {
        "documents": sum(count for _, count in documents),
        "statuses": dict(documents),
        "collections": db.scalar(
            select(func.count()).select_from(Collection).where(Collection.workspace_id == actor.workspace_id)
        ),
        "conversations": db.scalar(
            select(func.count())
            .select_from(Conversation)
            .where(Conversation.workspace_id == actor.workspace_id, Conversation.owner_id == actor.user_id)
        ),
        "open_actions": db.scalar(
            select(func.count())
            .select_from(Action)
            .where(Action.workspace_id == actor.workspace_id, Action.status != "done")
        ),
        "recent_documents": [
            {"id": d.id, "filename": d.filename, "status": d.status, "created_at": d.created_at.isoformat()}
            for d in db.scalars(
                select(Document)
                .where(*document_access(actor), Document.status != "deleted")
                .order_by(Document.created_at.desc())
                .limit(5)
            )
        ],
    }


@router.get("/usage/summary")
def usage_summary(actor: ActorDep, db: DB) -> dict[str, object]:
    actor.require("admin")
    rows = db.execute(
        select(func.date(Usage.created_at), func.count(), func.avg(Usage.duration_ms))
        .where(Usage.workspace_id == actor.workspace_id)
        .group_by(func.date(Usage.created_at))
        .order_by(func.date(Usage.created_at).desc())
        .limit(30)
    ).all()
    return {
        "days": [
            {"date": str(day), "requests": count, "latency_ms": round(latency)}
            for day, count, latency in reversed(rows)
        ],
        "tokens": db.scalar(select(func.sum(Usage.tokens)).where(Usage.workspace_id == actor.workspace_id)),
        "provider": settings().ai_provider,
        "model": settings().chat_model or None,
    }


@router.get("/usage/requests")
def usage_requests(actor: ActorDep, db: DB, page: int = Query(1, ge=1)) -> dict[str, object]:
    actor.require("admin")
    rows = paginate(
        db,
        select(Usage).where(Usage.workspace_id == actor.workspace_id).order_by(Usage.created_at.desc()),
        page,
    )
    return {
        "items": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat(),
                "model": r.model,
                "duration_ms": r.duration_ms,
                "tokens": r.tokens,
                "status": r.status,
            }
            for r in rows[:30]
        ],
        "has_more": len(rows) > 30,
    }


@router.get("/audit")
def audit_events(actor: ActorDep, db: DB, page: int = Query(1, ge=1)) -> dict[str, object]:
    actor.require("admin")
    rows = paginate(
        db,
        select(Audit).where(Audit.workspace_id == actor.workspace_id).order_by(Audit.created_at.desc()),
        page,
    )
    return {
        "items": [
            {
                "id": r.id,
                "operation": r.operation,
                "resource_id": r.resource_id,
                "created_at": r.created_at.isoformat(),
                "actor_id": r.actor_id,
            }
            for r in rows[:30]
        ],
        "has_more": len(rows) > 30,
    }
