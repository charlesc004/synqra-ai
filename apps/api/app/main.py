import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError
from sqlalchemy.exc import IntegrityError, OperationalError

from app.core.config import settings
from app.core.health import router as health_router
from app.modules import actions, agents, auth, conversations, evaluations, knowledge, workspaces

log = logging.getLogger("synqra")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings().storage_path.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="SYNQRA AI", version="0.1.0", lifespan=lifespan)
app.include_router(health_router, prefix="/api/v1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings().app_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token", "X-Workspace-Id"],
)
for router in [
    auth.router,
    workspaces.router,
    knowledge.router,
    conversations.router,
    actions.router,
    agents.router,
    evaluations.router,
]:
    app.include_router(router, prefix="/api/v1")


@app.exception_handler(IntegrityError)
async def conflict(request: Request, error: IntegrityError):
    return JSONResponse(
        status_code=409, content={"detail": "This operation conflicts with an existing record"}
    )


@app.exception_handler(OperationalError)
@app.exception_handler(RedisError)
async def unavailable(request: Request, error: Exception):
    log.warning("Dependency unavailable: %s", type(error).__name__)
    return JSONResponse(
        status_code=503, content={"detail": "A required database or queue service is unavailable"}
    )


@app.exception_handler(RequestValidationError)
async def validation(request: Request, error: RequestValidationError):
    # Do not echo submitted passwords, tokens, or document payloads in validation errors.
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Please check the submitted fields",
            "fields": [{"location": list(e["loc"]), "message": e["msg"]} for e in error.errors()],
        },
    )
