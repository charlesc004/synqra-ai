import asyncio
import hashlib

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.ai import ingestion, retrieval
from app.core.config import settings
from app.core.security import Actor
from app.models import Action, AgentRun, Approval, Chunk, Collection, Document, Membership, User, Workspace
from app.modules.actions import ActionBody, decide, execute_approved
from app.shared.access import accessible_document, scoped

pytestmark = pytest.mark.integration


def setup_workspace(db):
    user = User(name="Test owner", email="test@example.com", password_hash="unused")
    workspace = Workspace(name="Isolated test")
    db.add_all([user, workspace])
    db.flush()
    db.add(Membership(user_id=user.id, workspace_id=workspace.id, role="owner"))
    collection = Collection(
        workspace_id=workspace.id, name="Test", embedding_identity=settings().embedding_identity
    )
    db.add(collection)
    db.flush()
    return Actor(user.id, workspace.id, "owner"), collection


def add_document(db, actor, collection, name="policy.md", visibility="workspace"):
    document = Document(
        workspace_id=actor.workspace_id,
        collection_id=collection.id,
        filename=name,
        file_type=".md",
        size=10,
        content_hash=hashlib.sha256(name.encode()).hexdigest(),
        storage_key="test.md",
        uploaded_by=actor.user_id,
        status="ready",
        visibility=visibility,
    )
    db.add(document)
    db.flush()
    dimension = settings().embedding_dimension
    db.add(
        Chunk(
            document_id=document.id,
            workspace_id=actor.workspace_id,
            collection_id=collection.id,
            position=0,
            text="The remote work policy permits three days per week.",
            page=1,
            section="Remote work",
            token_start=0,
            token_end=12,
            content_hash="a" * 64,
            embedding=[1.0] + [0.0] * (dimension - 1),
            embedding_identity=settings().embedding_identity,
            index_version=1,
            search_vector=func.to_tsvector("english", "The remote work policy permits three days per week."),
        )
    )
    return document


def test_real_pgvector_hybrid_and_workspace_filter(postgres, monkeypatch):
    async def embedding(texts):
        return [[1.0] + [0.0] * (settings().embedding_dimension - 1) for _ in texts]

    monkeypatch.setattr(retrieval, "embed", embedding)
    with postgres() as db:
        actor, collection = setup_workspace(db)
        document = add_document(db, actor, collection)
        foreign = Workspace(name="Other")
        db.add(foreign)
        db.flush()
        db.commit()
        result = asyncio.run(retrieval.retrieve(db, actor, "remote work policy"))
        assert result and result[0].document_id == document.id
        stranger = Actor(actor.user_id, foreign.id, "viewer")
        assert asyncio.run(retrieval.retrieve(db, stranger, "remote work policy")) == []
        with pytest.raises(HTTPException):
            accessible_document(db, document.id, stranger)
        document.status = "deleted"
        db.commit()
        assert asyncio.run(retrieval.retrieve(db, actor, "remote work policy")) == []


def test_approval_requires_decision_and_executes_once(postgres):
    with postgres() as db:
        actor, collection = setup_workspace(db)
        run = AgentRun(workspace_id=actor.workspace_id, user_id=actor.user_id, workflow="action", request={})
        db.add(run)
        db.flush()
        approval = Approval(
            run_id=run.id,
            workspace_id=actor.workspace_id,
            proposal=ActionBody(title="Review policy").model_dump(mode="json"),
        )
        db.add(approval)
        db.commit()
        with pytest.raises(HTTPException):
            execute_approved(db, actor, approval.id)
        db.rollback()
        decide(db, actor, approval.id, True)
        first = execute_approved(db, actor, approval.id)
        db.commit()
        second = execute_approved(db, actor, approval.id)
        db.commit()
        assert first.id == second.id
        assert db.scalar(select(func.count()).select_from(Action)) == 1
        with pytest.raises(HTTPException):
            decide(db, actor, approval.id, False)


def test_private_documents_and_foreign_resources_are_denied(postgres):
    with postgres() as db:
        actor, collection = setup_workspace(db)
        document = add_document(db, actor, collection, visibility="private")
        db.commit()
        other = Actor("another-user", actor.workspace_id, "member")
        with pytest.raises(HTTPException):
            accessible_document(db, document.id, other)
        with pytest.raises(HTTPException):
            scoped(db, Collection, collection.id, Actor(actor.user_id, "another-workspace", "owner"))


def test_ingestion_retry_is_idempotent_with_real_vector_storage(postgres, monkeypatch, tmp_path):
    async def fixture_embed(texts):
        return [[1.0] + [0.0] * (settings().embedding_dimension - 1) for _ in texts]

    monkeypatch.setattr(ingestion, "SessionLocal", postgres)
    monkeypatch.setattr(ingestion, "embed", fixture_embed)
    monkeypatch.setattr(settings(), "embedding_provider", "ollama")
    monkeypatch.setattr(settings(), "embedding_model", "controlled-test-model")
    monkeypatch.setattr(settings(), "storage_path", tmp_path)
    (tmp_path / "test.md").write_text("# Remote work\nEmployees can work remotely three days each week.")
    with postgres() as db:
        actor, collection = setup_workspace(db)
        doc = add_document(db, actor, collection)
        doc.status = "queued"
        db.commit()
        identifier = doc.id
    ingestion.ingest(identifier)
    ingestion.ingest(identifier)
    with postgres() as db:
        document = db.get(Document, identifier)
        assert document.status == "ready"
        assert (
            db.scalar(select(func.count()).select_from(Chunk).where(Chunk.document_id == identifier))
            == document.chunk_count
        )
