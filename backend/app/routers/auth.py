"""Authentication endpoints: signup, login, and the current user."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import create_access_token, hash_password, verify_password
from ..database import get_session
from ..deps import get_current_user
from ..models import User
from ..responses import error, ok
from ..schemas import LoginRequest, SignupRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_dict(user: User) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "experience": user.experience}


@router.post("/signup")
async def signup(payload: SignupRequest, session: AsyncSession = Depends(get_session)) -> object:
    email = payload.email.lower().strip()
    existing = await session.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none() is not None:
        return error("That email is already registered. Try signing in.", status_code=409, code="email_taken")
    user = User(
        email=email, name=payload.name,
        password_hash=hash_password(payload.password),
        experience=payload.experience if payload.experience in {"new", "experienced"} else "new",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return ok(
        data={"token": create_access_token(user.id), "user": _user_dict(user)},
        message="Welcome to Tradeflow",
        status_code=status.HTTP_201_CREATED,
    )


@router.post("/login")
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_session)) -> object:
    email = payload.email.lower().strip()
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        return error("Incorrect email or password.", status_code=401, code="bad_credentials")
    return ok(
        data={"token": create_access_token(user.id), "user": _user_dict(user)},
        message="Signed in",
    )


@router.get("/me")
async def me(user: User = Depends(get_current_user)) -> object:
    return ok(data=_user_dict(user), message="Current user")
