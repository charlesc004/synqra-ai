from typing import Any, TypeVar

from fastapi import HTTPException
from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from app.core.security import Actor
from app.models import Audit, Base, Document

T = TypeVar("T", bound=Base)


def scoped(db: Session, model: type[T], resource_id: str, actor: Actor) -> T:
    record = db.get(model, resource_id)
    if record is None or getattr(record, "workspace_id", None) != actor.workspace_id:
        raise HTTPException(404, "Resource not found")
    return record


def document_access(actor: Actor) -> Any:
    return (
        Document.workspace_id == actor.workspace_id,
        or_(Document.visibility == "workspace", Document.uploaded_by == actor.user_id),
    )


def accessible_document(db: Session, document_id: str, actor: Actor) -> Document:
    document = db.scalar(
        select(Document).where(
            Document.id == document_id, *document_access(actor), Document.status != "deleted"
        )
    )
    if not document:
        raise HTTPException(404, "Document not found")
    return document


def audit(db: Session, actor: Actor, operation: str, resource_id: str, **details: Any) -> None:
    db.add(
        Audit(
            workspace_id=actor.workspace_id,
            actor_id=actor.user_id,
            operation=operation,
            resource_id=resource_id,
            details=details,
        )
    )


def paginate(db: Session, statement: Select[Any], page: int, size: int = 30) -> list[Any]:
    return list(db.scalars(statement.offset((page - 1) * size).limit(size + 1)).all())
