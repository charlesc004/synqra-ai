import hashlib
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ai.ingestion import stored_path
from app.ai.retrieval import retrieve
from app.core.config import settings
from app.core.security import DB, ActorDep
from app.jobs.queue import enqueue_ingestion
from app.models import Chunk, Collection, Document
from app.shared.access import accessible_document, audit, document_access, paginate, scoped

router = APIRouter(tags=["Knowledge"])


class CollectionBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)


def collection_public(collection: Collection) -> dict[str, object]:
    return {
        "id": collection.id,
        "name": collection.name,
        "description": collection.description,
        "embedding_identity": collection.embedding_identity,
        "index_version": collection.index_version,
    }


def document_public(document: Document) -> dict[str, object]:
    return {
        "id": document.id,
        "filename": document.filename,
        "file_type": document.file_type,
        "size": document.size,
        "status": document.status,
        "error": document.error,
        "chunk_count": document.chunk_count,
        "collection_id": document.collection_id,
        "created_at": document.created_at.isoformat(),
        "visibility": document.visibility,
        "embedding_identity": document.embedding_identity,
        "version": document.version,
    }


@router.get("/collections")
def collections(actor: ActorDep, db: DB) -> list[dict[str, object]]:
    return [
        collection_public(c)
        for c in db.scalars(
            select(Collection)
            .where(Collection.workspace_id == actor.workspace_id)
            .order_by(Collection.created_at)
            .limit(200)
        )
    ]


@router.post("/collections", status_code=201)
def create_collection(body: CollectionBody, actor: ActorDep, db: DB) -> dict[str, object]:
    actor.require("write")
    collection = Collection(
        workspace_id=actor.workspace_id, **body.model_dump(), embedding_identity=settings().embedding_identity
    )
    db.add(collection)
    db.commit()
    return collection_public(collection)


@router.patch("/collections/{collection_id}")
def update_collection(collection_id: str, body: CollectionBody, actor: ActorDep, db: DB) -> dict[str, object]:
    actor.require("write")
    collection = scoped(db, Collection, collection_id, actor)
    collection.name, collection.description = body.name, body.description
    db.commit()
    return collection_public(collection)


@router.delete("/collections/{collection_id}")
def delete_collection(collection_id: str, actor: ActorDep, db: DB) -> dict[str, str]:
    actor.require("admin")
    collection = scoped(db, Collection, collection_id, actor)
    if db.scalar(select(Document.id).where(Document.collection_id == collection.id).limit(1)):
        raise HTTPException(409, "Delete or move documents before deleting this collection")
    db.delete(collection)
    db.commit()
    return {"status": "deleted"}


@router.post("/collections/{collection_id}/reindex")
def reindex_collection(collection_id: str, actor: ActorDep, db: DB) -> dict[str, object]:
    actor.require("admin")
    collection = scoped(db, Collection, collection_id, actor)
    collection.embedding_identity = settings().embedding_identity
    collection.index_version += 1
    documents = list(
        db.scalars(
            select(Document)
            .where(Document.collection_id == collection.id, Document.status != "deleted")
            .with_for_update()
        )
    )
    for document in documents:
        document.status, document.error = "queued", None
    audit(db, actor, "collection.reindex", collection.id)
    db.commit()
    for document in documents:
        schedule(db, document)
    return {"status": "queued", "documents": len(documents)}


def schedule(db: Session, document: Document) -> None:
    try:
        enqueue_ingestion(document.id)
    except Exception:
        document.status, document.error = (
            "failed",
            "Queue unavailable. Retry when Redis and the worker are running.",
        )
        db.commit()


@router.get("/documents")
def documents(
    actor: ActorDep,
    db: DB,
    page: int = Query(1, ge=1),
    collection_id: str | None = None,
    q: str = Query("", max_length=200),
) -> dict[str, object]:
    statement = select(Document).where(*document_access(actor), Document.status != "deleted")
    if collection_id:
        statement = statement.where(Document.collection_id == collection_id)
    if q:
        statement = statement.where(Document.filename.ilike(f"%{q}%"))
    rows = paginate(db, statement.order_by(Document.created_at.desc()), page, 20)
    return {"items": [document_public(d) for d in rows[:20]], "has_more": len(rows) > 20, "page": page}


@router.post("/documents", status_code=201)
def upload(
    actor: ActorDep,
    db: DB,
    collection_id: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    visibility: Annotated[Literal["workspace", "private"], Form()] = "workspace",
) -> dict[str, object]:
    actor.require("write")
    collection = scoped(db, Collection, collection_id, actor)
    filename = (file.filename or "document").replace("\\", "/").split("/")[-1][:240]
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".docx", ".txt", ".md"}:
        raise HTTPException(415, "Supported types: PDF, DOCX, TXT, Markdown")
    content = file.file.read(settings().max_upload_mb * 1024 * 1024 + 1)
    if len(content) > settings().max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "File exceeds the configured upload limit")
    if not content:
        raise HTTPException(422, "The file is empty")
    if suffix == ".pdf" and not content.startswith(b"%PDF-"):
        raise HTTPException(415, "File content is not a valid PDF")
    if suffix == ".docx" and not content.startswith(b"PK"):
        raise HTTPException(415, "File content is not a valid DOCX")
    content_hash = hashlib.sha256(content).hexdigest()
    previous = db.scalar(
        select(Document)
        .where(
            Document.workspace_id == actor.workspace_id,
            Document.collection_id == collection.id,
            Document.filename == filename,
            Document.uploaded_by == actor.user_id,
            Document.status != "deleted",
        )
        .order_by(Document.version.desc())
    )
    if previous and previous.content_hash == content_hash:
        return document_public(previous)
    key = f"{uuid4()}{suffix}"
    path = stored_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    document = Document(
        workspace_id=actor.workspace_id,
        collection_id=collection.id,
        filename=filename,
        file_type=suffix,
        size=len(content),
        content_hash=content_hash,
        storage_key=key,
        uploaded_by=actor.user_id,
        visibility=visibility,
        version=previous.version + 1 if previous else 1,
    )
    try:
        db.add(document)
        db.flush()
        audit(db, actor, "document.upload", document.id)
        db.commit()
    except Exception:
        path.unlink(missing_ok=True)
        raise
    schedule(db, document)
    return document_public(document)


@router.get("/documents/{document_id}")
@router.get("/documents/{document_id}/status")
def document_detail(document_id: str, actor: ActorDep, db: DB) -> dict[str, object]:
    return document_public(accessible_document(db, document_id, actor))


@router.get("/documents/{document_id}/preview")
def preview(document_id: str, actor: ActorDep, db: DB) -> dict[str, object]:
    document = accessible_document(db, document_id, actor)
    chunks = db.scalars(
        select(Chunk).where(Chunk.document_id == document.id).order_by(Chunk.position).limit(100)
    )
    return {
        "document": document_public(document),
        "text": document.preview,
        "chunks": [{"id": c.id, "text": c.text, "page": c.page, "section": c.section} for c in chunks],
    }


@router.post("/documents/{document_id}/retry")
def retry(document_id: str, actor: ActorDep, db: DB) -> dict[str, object]:
    actor.require("write")
    document = accessible_document(db, document_id, actor)
    if document.status in {"queued", "processing", "retrying"}:
        raise HTTPException(409, "Document processing is already queued")
    document.status, document.error = "queued", None
    db.commit()
    schedule(db, document)
    return document_public(document)


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, actor: ActorDep, db: DB) -> dict[str, str]:
    actor.require("write")
    document = accessible_document(db, document_id, actor)
    if document.uploaded_by != actor.user_id:
        actor.require("admin")
    db.refresh(document, with_for_update=True)
    document.status, document.preview, document.chunk_count = "deleted", "", 0
    db.execute(delete(Chunk).where(Chunk.document_id == document.id))
    audit(db, actor, "document.delete", document.id)
    db.commit()
    stored_path(document.storage_key).unlink(missing_ok=True)
    return {"status": "deleted"}


class SearchBody(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    collection_id: str | None = None
    document_ids: list[str] = Field(default_factory=list, max_length=10)
    mode: Literal["hybrid", "semantic", "keyword"] = "hybrid"


@router.post("/knowledge/search")
async def search(body: SearchBody, actor: ActorDep, db: DB) -> dict[str, object]:
    result = await retrieve(db, actor, body.query, body.collection_id, body.document_ids, mode=body.mode)
    return {"items": [item.public() for item in result], "mode": body.mode}
