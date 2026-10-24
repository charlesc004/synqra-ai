"""Actual PostgreSQL checkpoints and graph execution; deterministic model boundary only."""

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from langgraph.checkpoint.postgres import PostgresSaver
from sqlalchemy import func, select
from test_workflows import add_document, setup_workspace

from app.ai import agents
from app.core.security import Actor
from app.models import Action, AgentRun, Approval, Membership
from app.modules.actions import decide, execute_approved

pytestmark = pytest.mark.integration


class ControlledProvider:
    def __init__(self):
        self.usage = {}

    async def structured(self, messages, schema):
        return schema.model_validate(
            {
                "title": "Review access",
                "description": "Review the documented policy.",
                "source_labels": ["S1"],
            }
        )

    async def search_tool_call(self, question):
        return {"query": question}

    async def stream(self, messages):
        yield "The policy allows three remote days. [S1]"


@pytest.fixture
def graph_context(postgres, monkeypatch):
    monkeypatch.setattr(agents, "SessionLocal", postgres)
    monkeypatch.setattr(agents, "ModelProvider", ControlledProvider)
    url = os.environ["TEST_DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://")
    with PostgresSaver.from_conn_string(url) as saver:
        saver.setup()
    with postgres() as db:
        actor, collection = setup_workspace(db)
        document = add_document(db, actor, collection)
        run = AgentRun(
            workspace_id=actor.workspace_id,
            user_id=actor.user_id,
            workflow="action",
            request={
                "workflow": "action",
                "question": "Propose a policy review",
                "document_ids": [document.id],
            },
        )
        db.add(run)
        db.commit()
        yield actor, run.id, document.id


def test_graph_persists_interrupt_and_resumes_once(graph_context, postgres):
    actor, run_id, _ = graph_context
    output = asyncio.run(agents.invoke_run(run_id, actor))
    assert output.get("__interrupt__")
    with postgres() as db:
        run = db.get(AgentRun, run_id)
        approval = db.scalar(select(Approval).where(Approval.run_id == run_id))
        assert run.status == "awaiting_approval" and approval.status == "pending"
        assert db.scalar(select(func.count()).select_from(Action)) == 0
        decide(db, actor, approval.id, True)
    # A new saver and compiled graph are created on resume, as after an API restart.
    asyncio.run(agents.invoke_run(run_id, actor, resume=True))
    with postgres() as db:
        run = db.get(AgentRun, run_id)
        assert run.status == "completed"
        assert db.scalar(select(func.count()).select_from(Action)) == 1
        first = db.scalar(select(Action))
        approval = db.scalar(select(Approval).where(Approval.run_id == run_id))
        assert execute_approved(db, actor, approval.id).id == first.id


def test_rejected_graph_does_not_execute(graph_context, postgres):
    actor, run_id, _ = graph_context
    asyncio.run(agents.invoke_run(run_id, actor))
    with postgres() as db:
        approval = db.scalar(select(Approval).where(Approval.run_id == run_id))
        decide(db, actor, approval.id, False)
    asyncio.run(agents.invoke_run(run_id, actor, resume=False))
    with postgres() as db:
        assert db.get(AgentRun, run_id).status == "rejected"
        assert db.scalar(select(func.count()).select_from(Action)) == 0


def test_revoked_role_blocks_graph_write(graph_context, postgres):
    actor, run_id, _ = graph_context
    asyncio.run(agents.invoke_run(run_id, actor))
    with postgres() as db:
        approval = db.scalar(select(Approval).where(Approval.run_id == run_id))
        decide(db, actor, approval.id, True)
        db.get(Membership, (actor.user_id, actor.workspace_id)).role = "viewer"
        db.commit()
    with pytest.raises(HTTPException) as error:
        asyncio.run(agents.invoke_run(run_id, actor, resume=True))
    assert error.value.status_code == 403
    with postgres() as db:
        assert db.scalar(select(func.count()).select_from(Action)) == 0


def test_parallel_approval_execution_creates_one_action(graph_context, postgres):
    actor, run_id, _ = graph_context
    asyncio.run(agents.invoke_run(run_id, actor))
    with postgres() as db:
        approval = db.scalar(select(Approval).where(Approval.run_id == run_id))
        approval_id = approval.id
        decide(db, actor, approval_id, True)

    def execute():
        with postgres() as db:
            action = execute_approved(db, actor, approval_id)
            db.commit()
            return action.id

    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(lambda _: execute(), range(2)))
    assert result[0] == result[1]
    with postgres() as db:
        assert db.scalar(select(func.count()).select_from(Action)) == 1


def test_other_workspace_cannot_resume_run(graph_context):
    actor, run_id, _ = graph_context
    with pytest.raises(HTTPException) as error:
        asyncio.run(agents.invoke_run(run_id, Actor(actor.user_id, "foreign-workspace", "owner")))
    assert error.value.status_code == 404
