"""
Shared FastAPI dependencies. Auth is JWT-based: clients send
`Authorization: Bearer <token>` from /auth/signup or /auth/login. For local
dev/tests (non-production APP_ENV) an `X-User-Id` header is also accepted.
"""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import decode_access_token
from .config import get_settings
from .database import get_session
from .models import User

_UNAUTH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Please sign in to continue.",
)


async def get_current_user(
    authorization: str | None = Header(default=None),
    x_user_id: int | None = Header(default=None, alias="X-User-Id"),
    session: AsyncSession = Depends(get_session),
) -> User:
    user_id: int | None = None
    if authorization and authorization.lower().startswith("bearer "):
        user_id = decode_access_token(authorization[7:].strip())
    if user_id is None and x_user_id is not None and get_settings().app_env != "production":
        user_id = x_user_id
    if user_id is None:
        raise _UNAUTH
    user = await session.get(User, user_id)
    if user is None:
        raise _UNAUTH
    return user
