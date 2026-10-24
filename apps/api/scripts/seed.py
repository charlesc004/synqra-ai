"""Idempotent fictional corpus. Requires an explicit seed password; never fabricates embeddings."""

import hashlib
from pathlib import Path

from sqlalchemy import select

from app.ai.ingestion import stored_path
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import hasher
from app.jobs.queue import enqueue_ingestion
from app.models import Action, Collection, Document, Membership, User, Workspace


def seed() -> None:
    password = settings().seed_password
    if len(password) < 12:
        raise SystemExit("Set SEED_PASSWORD to at least 12 characters before seeding.")
    corpus = Path(__file__).resolve().parents[3] / "datasets" / "demo-documents"
    pending: list[str] = []
    with SessionLocal() as db:
        people = [
            ("Alex Morgan", "alex@northstar.example", "owner"),
            ("Jamie Chen", "jamie@northstar.example", "member"),
            ("Casey Rivera", "casey@northstar.example", "viewer"),
        ]
        users = []
        for name, email, role in people:
            user = db.scalar(select(User).where(User.email == email))
            if not user:
                user = User(name=name, email=email, password_hash=hasher.hash(password))
                db.add(user)
                db.flush()
            users.append(user)
        workspace = db.scalar(select(Workspace).where(Workspace.name == "Northstar Digital Operations"))
        if not workspace:
            workspace = Workspace(name="Northstar Digital Operations")
            db.add(workspace)
            db.flush()
        for user, (_, _, role) in zip(users, people, strict=True):
            if not db.get(Membership, (user.id, workspace.id)):
                db.add(Membership(user_id=user.id, workspace_id=workspace.id, role=role))
        collections = {}
        for name, description in [
            ("People & Culture", "How we work, together."),
            ("Engineering", "Systems, security, and product knowledge."),
            ("Operations", "Delivering thoughtful customer experiences."),
        ]:
            collection = db.scalar(
                select(Collection).where(Collection.workspace_id == workspace.id, Collection.name == name)
            )
            if not collection:
                collection = Collection(
                    workspace_id=workspace.id,
                    name=name,
                    description=description,
                    embedding_identity=settings().embedding_identity,
                )
                db.add(collection)
                db.flush()
            collections[name] = collection
        for path in sorted(corpus.glob("*.md")):
            existing = db.scalar(
                select(Document).where(
                    Document.workspace_id == workspace.id,
                    Document.filename == path.name,
                    Document.status != "deleted",
                )
            )
            if existing:
                continue
            group = (
                "People & Culture"
                if path.stem in {"employee-handbook", "remote-work-policy"}
                else "Engineering"
                if any(term in path.stem for term in ["security", "api-", "product-", "troubleshooting"])
                else "Operations"
            )
            content = path.read_bytes()
            document = Document(
                workspace_id=workspace.id,
                collection_id=collections[group].id,
                filename=path.name,
                file_type=".md",
                size=len(content),
                content_hash=hashlib.sha256(content).hexdigest(),
                storage_key=f"seed-{path.name}",
                uploaded_by=users[0].id,
                status="queued",
            )
            stored_path(document.storage_key).parent.mkdir(parents=True, exist_ok=True)
            stored_path(document.storage_key).write_bytes(content)
            db.add(document)
            db.flush()
            pending.append(document.id)
        for title, description in [
            (
                "Review the next access audit",
                "Fictional demonstration task: confirm an owner for the next policy review.",
            ),
            (
                "Prepare support handover",
                "Fictional demonstration task: review the documented delivery handover checklist.",
            ),
        ]:
            if not db.scalar(
                select(Action.id).where(Action.workspace_id == workspace.id, Action.title == title)
            ):
                db.add(
                    Action(
                        workspace_id=workspace.id,
                        created_by=users[0].id,
                        title=title,
                        description=description,
                        status="open",
                    )
                )
        db.commit()
    for document_id in pending:
        try:
            enqueue_ingestion(document_id)
        except Exception:
            with SessionLocal() as db:
                document = db.get(Document, document_id)
                assert document
                document.status, document.error = "failed", "Queue unavailable. Retry from Knowledge Base."
                db.commit()
    print(
        f"Northstar seed complete. {len(pending)} new documents accepted; indexing is performed by the worker."
    )
    print(
        "Fictional accounts: alex@northstar.example (owner), jamie@northstar.example (member), casey@northstar.example (viewer)."
    )


if __name__ == "__main__":
    seed()
