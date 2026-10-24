import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, cast

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import Depends, Header, HTTPException, Request, Response
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import database
from app.models import AuthSession, Membership, User

hasher = PasswordHasher()
DB = Annotated[Session, Depends(database)]


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return hasher.verify(password_hash, password)
    except VerificationError:
        return False


def origin_check(request: Request) -> None:
    if request.headers.get("origin") != settings().app_origin:
        raise HTTPException(403, "Request origin is not allowed")


def rate_limit(key: str, limit: int, seconds: int = 60) -> None:
    # Redis is shared across API processes; failure is deliberately fail-closed.
    # Counter and expiry must be atomic, including recovery of an old key without a TTL.
    with Redis.from_url(settings().redis_url) as redis:
        count = cast(
            int,
            redis.eval(
                "local n = redis.call('INCR', KEYS[1]); "
                "if n == 1 or redis.call('TTL', KEYS[1]) < 0 then "
                "redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n",
                1,
                f"rate:{key}",
                seconds,
            ),
        )
    if count > limit:
        raise HTTPException(429, "Too many requests. Try again later.")


def issue_session(db: Session, user: User, response: Response) -> str:
    token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    db.add(
        AuthSession(
            token_hash=digest(token),
            user_id=user.id,
            csrf=csrf,
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )
    )
    response.set_cookie(
        "synqra_session",
        token,
        httponly=True,
        secure=settings().cookie_secure,
        samesite="lax",
        max_age=604800,
        path="/",
    )
    response.set_cookie(
        "synqra_csrf",
        csrf,
        httponly=False,
        secure=settings().cookie_secure,
        samesite="lax",
        max_age=604800,
        path="/",
    )
    return csrf


def current_user(request: Request, db: DB) -> User:
    token = request.cookies.get("synqra_session", "")
    session = db.get(AuthSession, digest(token)) if token else None
    if not session or session.expires_at <= datetime.now(UTC):
        raise HTTPException(401, "Please sign in")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin_check(request)
        if not secrets.compare_digest(request.headers.get("x-csrf-token", ""), session.csrf):
            raise HTTPException(403, "Invalid CSRF token")
    user = db.get(User, session.user_id)
    if not user:
        raise HTTPException(401, "Please sign in")
    return user


UserDep = Annotated[User, Depends(current_user)]


@dataclass(frozen=True)
class Actor:
    user_id: str
    workspace_id: str
    role: str

    def require(self, permission: str) -> None:
        allowed = {
            "read": {"owner", "admin", "member", "viewer"},
            "write": {"owner", "admin", "member"},
            "admin": {"owner", "admin"},
        }
        if self.role not in allowed.get(permission, set()):
            raise HTTPException(403, "Your workspace role does not allow this operation")


def workspace_actor(user: UserDep, db: DB, x_workspace_id: Annotated[str, Header()]) -> Actor:
    membership = db.scalar(
        select(Membership).where(Membership.user_id == user.id, Membership.workspace_id == x_workspace_id)
    )
    if not membership:
        raise HTTPException(403, "Workspace access denied")
    return Actor(user.id, x_workspace_id, membership.role)


ActorDep = Annotated[Actor, Depends(workspace_actor)]
