"""Authenticated HTTP boundaries against real PostgreSQL and Redis."""

from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy import select
from test_workflows import add_document, setup_workspace

from app.core.config import settings
from app.core.database import database
from app.core.security import hasher, rate_limit
from app.main import app
from app.models import (
    Collection,
    Conversation,
    Document,
    Evaluation,
    Membership,
    User,
    Workspace,
)

pytestmark = pytest.mark.integration
PASSWORD = "controlled-password-2026"


def test_rate_limit_recovers_expiry_and_enforces_shared_counter(postgres):
    key = f"audit-{uuid4().hex}"
    with Redis.from_url(settings().redis_url) as redis:
        try:
            redis.set(f"rate:{key}", 1)
            rate_limit(key, 2, 30)
            assert 0 < redis.ttl(f"rate:{key}") <= 30
            with pytest.raises(HTTPException) as error:
                rate_limit(key, 2, 30)
            assert error.value.status_code == 429
        finally:
            redis.delete(f"rate:{key}")


@pytest.fixture
def http_context(postgres):
    with postgres() as db:
        actor, collection = setup_workspace(db)
        db.get(User, actor.user_id).password_hash = hasher.hash(PASSWORD)
        document = add_document(db, actor, collection)
        private = add_document(db, actor, collection, "private.md", "private")
        viewer = User(name="Read only", email="viewer@example.com", password_hash=hasher.hash(PASSWORD))
        foreign_workspace = Workspace(name="Foreign workspace")
        db.add_all([viewer, foreign_workspace])
        db.flush()
        db.add(Membership(user_id=viewer.id, workspace_id=actor.workspace_id, role="viewer"))
        conversation = Conversation(
            workspace_id=actor.workspace_id,
            owner_id=actor.user_id,
            title="Owner private conversation",
            collection_id=collection.id,
        )
        foreign_collection = Collection(
            workspace_id=foreign_workspace.id,
            name="Foreign",
            embedding_identity=settings().embedding_identity,
        )
        db.add_all([conversation, foreign_collection])
        db.flush()
        db.commit()
        context = {
            "actor": actor,
            "collection_id": collection.id,
            "document_id": document.id,
            "private_id": private.id,
            "conversation_id": conversation.id,
            "foreign_workspace_id": foreign_workspace.id,
            "foreign_collection_id": foreign_collection.id,
        }

    def override_database():
        with postgres() as db:
            yield db

    app.dependency_overrides[database] = override_database
    try:
        with TestClient(app, client=(f"security-{uuid4().hex}", 50000)) as client:
            yield client, context
    finally:
        app.dependency_overrides.pop(database, None)


def login(client, email="test@example.com"):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": PASSWORD},
        headers={"Origin": settings().app_origin},
    )
    assert response.status_code == 200, response.text


def headers(client, workspace_id):
    return {
        "Origin": settings().app_origin,
        "X-CSRF-Token": client.cookies["synqra_csrf"],
        "X-Workspace-Id": workspace_id,
    }


def test_csrf_and_origin_are_required_for_writes(http_context):
    client, context = http_context
    login(client)
    valid = headers(client, context["actor"].workspace_id)
    assert (
        client.post(
            "/api/v1/collections",
            json={"name": "Missing CSRF"},
            headers={"Origin": valid["Origin"], "X-Workspace-Id": valid["X-Workspace-Id"]},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/collections",
            json={"name": "Wrong origin"},
            headers={**valid, "Origin": "https://untrusted.example"},
        ).status_code
        == 403
    )
    assert (
        client.post("/api/v1/collections", json={"name": "Valid request"}, headers=valid).status_code == 201
    )


def test_viewer_cannot_upload_create_actions_or_run_evaluations(http_context):
    client, context = http_context
    login(client, "viewer@example.com")
    valid = headers(client, context["actor"].workspace_id)
    assert (
        client.post(
            "/api/v1/documents",
            data={"collection_id": context["collection_id"]},
            files={"file": ("policy.md", b"# Policy\nTest content", "text/markdown")},
            headers=valid,
        ).status_code
        == 403
    )
    assert client.post("/api/v1/actions", json={"title": "Unauthorized"}, headers=valid).status_code == 403
    assert client.get("/api/v1/evaluations", headers=valid).status_code == 403
    assert client.get(f"/api/v1/documents/{context['private_id']}/preview", headers=valid).status_code == 404
    assert client.get(f"/api/v1/conversations/{context['conversation_id']}", headers=valid).status_code == 404
    assert client.get(f"/api/v1/documents/{context['document_id']}/preview", headers=valid).status_code == 200


def test_evaluation_snapshots_do_not_bypass_private_document_access(http_context, postgres):
    client, context = http_context
    with postgres() as db:
        colleague = db.scalar(select(User).where(User.email == "viewer@example.com"))
        db.get(Membership, (colleague.id, context["actor"].workspace_id)).role = "admin"
        run = Evaluation(
            workspace_id=context["actor"].workspace_id,
            status="completed",
            configuration={
                "name": "Private benchmark",
                "cases": [{"question": "Policy?", "relevant_document_ids": []}],
            },
            results=[
                {
                    "question": "Policy?",
                    "expected": [],
                    "retrieved": [context["private_id"]],
                    "excerpts": [{"document_id": context["private_id"], "text": "PRIVATE SECRET"}],
                }
            ],
        )
        db.add(run)
        db.commit()
        run_id = run.id
    login(client, "viewer@example.com")
    valid = headers(client, context["actor"].workspace_id)
    assert client.get(f"/api/v1/evaluations/runs/{run_id}", headers=valid).status_code == 404
    assert all(
        item["id"] != run_id for item in client.get("/api/v1/evaluations", headers=valid).json()["items"]
    )
    login(client)
    valid = headers(client, context["actor"].workspace_id)
    assert client.get(f"/api/v1/evaluations/runs/{run_id}", headers=valid).status_code == 200
    with postgres() as db:
        db.get(Document, context["private_id"]).status = "deleted"
        db.commit()
    assert client.get(f"/api/v1/evaluations/runs/{run_id}", headers=valid).status_code == 404


def test_foreign_workspace_header_and_foreign_collection_are_denied(http_context):
    client, context = http_context
    login(client)
    valid = headers(client, context["actor"].workspace_id)
    assert (
        client.get(
            "/api/v1/documents", headers={**valid, "X-Workspace-Id": context["foreign_workspace_id"]}
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/v1/collections/{context['foreign_collection_id']}", json={"name": "Attack"}, headers=valid
        ).status_code
        == 404
    )


def test_refresh_rotates_token_and_logout_revokes_it(http_context):
    client, context = http_context
    login(client)
    old_token = client.cookies["synqra_session"]
    valid = headers(client, context["actor"].workspace_id)
    assert client.post("/api/v1/auth/refresh", headers=valid).status_code == 200
    new_token = client.cookies["synqra_session"]
    assert old_token != new_token
    assert client.get("/api/v1/auth/me", headers={"Cookie": f"synqra_session={old_token}"}).status_code == 401
    assert client.get("/api/v1/auth/me").status_code == 200
    assert (
        client.post("/api/v1/auth/logout", headers=headers(client, context["actor"].workspace_id)).status_code
        == 200
    )
    assert client.get("/api/v1/auth/me").status_code == 401


def test_renaming_a_conversation_preserves_its_knowledge_scope(http_context):
    client, context = http_context
    login(client)
    valid = headers(client, context["actor"].workspace_id)
    path = f"/api/v1/conversations/{context['conversation_id']}"
    assert client.patch(path, json={"title": "Renamed only"}, headers=valid).status_code == 200
    result = client.get(path, headers=valid).json()
    assert result["title"] == "Renamed only"
    assert result["collection_id"] == context["collection_id"]
