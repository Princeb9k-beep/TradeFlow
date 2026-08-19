"""Pydantic request schemas."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


# --- Auth -----------------------------------------------------------------
class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str | None = None
    experience: str = Field(default="new", examples=["new", "experienced"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


# --- Trading --------------------------------------------------------------
class OrderRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=20, examples=["AAPL"])
    side: str = Field(examples=["buy", "sell"])
    quantity: float = Field(gt=0, le=1_000_000)
    type: str = Field(default="market", examples=["market", "limit", "stop"])
    limit_price: float | None = Field(default=None, gt=0)   # for limit orders
    stop_price: float | None = Field(default=None, gt=0)    # trigger for stop orders
    take_profit: float | None = Field(default=None, gt=0)   # bracket TP (on a buy)
    stop_loss: float | None = Field(default=None, gt=0)     # bracket SL (on a buy)
    note: str | None = Field(default=None, max_length=255)


class WatchlistRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=20, examples=["NVDA"])


class ScreenRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200, examples=["oversold large-caps in an uptrend"])
    symbols: list[str] = Field(default_factory=list)


class PositionSizeRequest(BaseModel):
    entry: float = Field(gt=0)
    stop: float = Field(gt=0)
    risk_pct: float = Field(default=1.0, gt=0, le=100)
    equity: float | None = Field(default=None, gt=0)


class JournalRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    side: str = Field(default="buy", examples=["buy", "sell"])
    entry_price: float | None = None
    exit_price: float | None = None
    stop_price: float | None = None
    quantity: float | None = None
    thesis: str | None = Field(default=None, max_length=4000)
    emotion: str | None = Field(default=None, max_length=40)
    tags: list[str] = Field(default_factory=list)


class ChallengeAnswerRequest(BaseModel):
    token: str
    choice: str = Field(examples=["buy", "sell", "wait"])


class AccountSettingsRequest(BaseModel):
    risk_per_trade_pct: float | None = Field(default=None, gt=0, le=100)
    max_daily_loss_pct: float | None = Field(default=None, gt=0, le=100)
    reset: bool = False
