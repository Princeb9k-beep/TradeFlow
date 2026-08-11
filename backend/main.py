"""
Tradeflow — FastAPI application entry point.

Run locally:
    uvicorn main:app --reload

Wires everything together:
  * lifespan startup/shutdown initializes the async DB engine, Redis pool, and
    Groq client, and closes them cleanly.
  * a global exception handler returns the standard response envelope.
  * a lightweight rate limiter protects the AI screener endpoint.
  * the health, auth, and trading routers are mounted, then (when built) the
    React SPA is served so one process serves API + frontend.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.database import dispose_engine, get_engine
from app.groq_client import init_groq
from app.redis_client import close_redis, init_redis
from app.resilience import TokenBucketRateLimiter
from app.responses import error
from app.routers import auth, health, trading

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tradeflow")

# Protect the AI screener: 30 requests/minute per user (fails open if Redis down).
ai_rate_limiter = TokenBucketRateLimiter(limit=30, window_seconds=60)
_AI_PATHS = frozenset({"/trading/screen"})


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("Starting Tradeflow (env=%s)", settings.app_env)
    get_engine()
    await init_redis()
    init_groq()
    try:
        yield
    finally:
        await close_redis()
        await dispose_engine()
        logger.info("Tradeflow shut down cleanly")


app = FastAPI(
    title="Tradeflow",
    version="1.0.0",
    description="AI-assisted day-trading platform: charts, paper trading, and an AI coach.",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def rate_limit_ai(request: Request, call_next):
    if request.url.path in _AI_PATHS:
        who = request.headers.get("X-User-Id") or (request.client.host if request.client else "anon")
        if not await ai_rate_limiter.allow(f"ai:{who}"):
            return error(
                "You're going a bit fast — please wait a moment and try again.",
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                code="rate_limited",
            )
    return await call_next(request)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return error(str(exc.detail), status_code=exc.status_code, code="http_error")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return error(
        "Some fields were invalid. Please check your input.",
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        code="validation_error",
        details=exc.errors(),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s", request.url.path)
    return error(
        "Something went wrong on our end. Please try again.",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        code="internal_error",
    )


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(trading.router)


# --- Serve the built React frontend (single-app deployment) ---------------
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
_SPA_EXCLUDE_EXACT = frozenset({"/docs", "/redoc", "/openapi.json"})
_NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}


def _index_response() -> FileResponse:
    return FileResponse(FRONTEND_DIST / "index.html", headers=_NO_CACHE)


@app.middleware("http")
async def spa_navigation_fallback(request: Request, call_next):
    if (
        FRONTEND_DIST.is_dir()
        and request.method == "GET"
        and "text/html" in request.headers.get("accept", "")
        and request.url.path not in _SPA_EXCLUDE_EXACT
        and not request.url.path.startswith("/assets/")
        and "." not in request.url.path.rsplit("/", 1)[-1]
    ):
        return _index_response()
    return await call_next(request)


if FRONTEND_DIST.is_dir():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return _index_response()

else:

    @app.get("/")
    async def root() -> object:
        from app.responses import ok
        return ok(
            data={"name": "Tradeflow", "docs": "/docs", "health": "/health"},
            message="Tradeflow API (frontend not built)",
        )
