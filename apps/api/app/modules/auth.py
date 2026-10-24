from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.security import (
    DB,
    UserDep,
    digest,
    hasher,
    issue_session,
    origin_check,
    rate_limit,
    verify_password,
)
from app.models import AuthSession, Collection, Membership, User, Workspace

router = APIRouter(prefix="/auth", tags=["Authentication"])


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class Registration(Credentials):
    name: str = Field(min_length=1, max_length=120, pattern=r"\S")


def public_user(user: User) -> dict[str, str]:
    return {"id": user.id, "name": user.name, "email": user.email}


@router.post("/register", status_code=201)
def register(body: Registration, request: Request, response: Response, db: DB) -> dict[str, str]:
    origin_check(request)
    rate_limit(f"register:{request.client.host if request.client else 'unknown'}", 5, 3600)
    user = User(name=body.name.strip(), email=body.email.lower(), password_hash=hasher.hash(body.password))
    db.add(user)
    try:
        db.flush()
        workspace = Workspace(name=f"{body.name.split()[0]}'s workspace")
        db.add(workspace)
        db.flush()
        db.add(Membership(user_id=user.id, workspace_id=workspace.id, role="owner"))
        db.add(
            Collection(
                workspace_id=workspace.id,
                name="General knowledge",
                description="Your team's shared knowledge",
                embedding_identity=settings().embedding_identity,
            )
        )
        issue_session(db, user, response)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This email is already registered") from None
    return public_user(user)


@router.post("/login")
def login(body: Credentials, request: Request, response: Response, db: DB) -> dict[str, str]:
    origin_check(request)
    rate_limit(f"login:{request.client.host if request.client else 'unknown'}", 10, 300)
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    # Hash even when no user exists to reduce account timing disclosure.
    candidate = user.password_hash if user else hasher.hash("not-an-account-password")
    valid = verify_password(body.password, candidate)
    if not user or not valid:
        raise HTTPException(401, "Invalid email or password")
    issue_session(db, user, response)
    db.commit()
    return public_user(user)


@router.get("/me")
def me(user: UserDep) -> dict[str, str]:
    return public_user(user)


@router.post("/refresh")
def refresh(user: UserDep, request: Request, response: Response, db: DB) -> dict[str, str]:
    # Rotation consumes the old token under a row lock.
    session = db.scalar(
        select(AuthSession)
        .where(AuthSession.token_hash == digest(request.cookies.get("synqra_session", "")))
        .with_for_update()
    )
    if not session:
        raise HTTPException(401, "Session already renewed")
    db.delete(session)
    issue_session(db, user, response)
    db.commit()
    return {"status": "renewed"}


@router.post("/logout")
def logout(user: UserDep, request: Request, response: Response, db: DB) -> dict[str, str]:
    db.execute(
        delete(AuthSession).where(AuthSession.token_hash == digest(request.cookies.get("synqra_session", "")))
    )
    db.commit()
    response.delete_cookie("synqra_session")
    response.delete_cookie("synqra_csrf")
    return {"status": "signed_out"}


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


@router.post("/password")
def password_change(body: PasswordChange, user: UserDep, db: DB, response: Response) -> dict[str, str]:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hasher.hash(body.new_password)
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    issue_session(db, user, response)
    db.commit()
    return {"status": "updated"}
