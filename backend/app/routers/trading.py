"""
Trading platform endpoints — the core of Tradeflow.

Market data (quotes/candles), a watchlist, order placement through the broker
abstraction, positions/orders, an AI chart read, a natural-language screener, a
position sizer (the risk guardrail), a trade journal with AI coaching, and a
starter Academy curriculum for new traders.

Real-broker execution is reachable through the same endpoints once
LIVE_TRADING_ENABLED is set (see app/brokers.py); until then every order settles
against virtual cash. Nothing here is financial advice.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..brokers import OrderError, get_or_create_account, positions_for, select_broker
from ..config import get_settings
from ..database import get_session
from ..deps import get_current_user
from ..market_data import DEFAULT_UNIVERSE, TIMEFRAMES, get_candles, get_quote, get_quotes
from ..models import TradeJournalEntry, TradingOrder, User, Watchlist
from ..responses import error, ok
from .. import symbols
from ..schemas import (
    AccountSettingsRequest,
    ChallengeAnswerRequest,
    JournalRequest,
    OrderRequest,
    PositionSizeRequest,
    ScreenRequest,
    WatchlistRequest,
)
from ..skills import challenge, ta, trade_ai
from ..skills.trading_curriculum import CURRICULUM

router = APIRouter(prefix="/trading", tags=["trading"])


async def _account(session: AsyncSession, user: User):
    return await get_or_create_account(
        session, user.id, starting_cash=get_settings().paper_starting_cash
    )


def _unknown_symbol(symbol: str):
    """Return an error response if `symbol` isn't a real, listed instrument.

    Enforced for the catalog-backed providers (yahoo, synthetic) so a fabricated
    ticker can never yield a chart. With a broker provider (Alpaca) the provider
    itself is the authority on tradable symbols, so we don't second-guess it
    against a partial local catalog.
    """
    if get_settings().market_data_provider != "alpaca" and not symbols.is_known(symbol):
        return error(
            f"'{symbols.normalize(symbol)}' isn't a recognized ticker. "
            "Search real symbols at /trading/symbols.",
            status_code=404,
            code="unknown_symbol",
        )
    return None


# --- Symbol catalog / search ---------------------------------------------
@router.get("/symbols")
async def list_symbols(
    q: str = Query(default=""),
    limit: int = Query(default=20, ge=1, le=100),
    _: User = Depends(get_current_user),
) -> object:
    return ok(data={"symbols": symbols.search(q, limit)}, message="Symbols")


# --- Market data ----------------------------------------------------------
@router.get("/quote/{symbol:path}")
async def quote(symbol: str, _: User = Depends(get_current_user)) -> object:
    bad = _unknown_symbol(symbol)
    if bad:
        return bad
    return ok(data=await get_quote(symbol), message="Quote")


@router.get("/candles/{symbol:path}")
async def candles(
    symbol: str,
    timeframe: str = Query(default="1d"),
    limit: int = Query(default=120, ge=2, le=500),
    _: User = Depends(get_current_user),
) -> object:
    if timeframe not in TIMEFRAMES:
        return error(f"Unsupported timeframe. Use one of: {', '.join(TIMEFRAMES)}", code="bad_timeframe")
    bad = _unknown_symbol(symbol)
    if bad:
        return bad
    bars = await get_candles(symbol, timeframe, limit)
    return ok(data={"symbol": symbol.upper(), "timeframe": timeframe, "candles": bars}, message="Candles")


# --- Watchlist ------------------------------------------------------------
@router.get("/watchlist")
async def get_watchlist(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> object:
    result = await session.execute(
        select(Watchlist).where(Watchlist.user_id == user.id).order_by(Watchlist.created_at)
    )
    symbols = [w.symbol for w in result.scalars().all()]
    if not symbols:
        symbols = DEFAULT_UNIVERSE[:6]
    quotes = await get_quotes(symbols)
    return ok(data={"symbols": symbols, "quotes": quotes}, message="Watchlist")


@router.post("/watchlist")
async def add_watchlist(
    payload: WatchlistRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> object:
    bad = _unknown_symbol(payload.symbol)
    if bad:
        return bad
    symbol = payload.symbol.strip().upper()
    existing = await session.execute(
        select(Watchlist).where(Watchlist.user_id == user.id, Watchlist.symbol == symbol)
    )
    if existing.scalar_one_or_none() is None:
        session.add(Watchlist(user_id=user.id, symbol=symbol))
        await session.commit()
    return ok(data={"symbol": symbol}, message=f"Added {symbol}")


@router.delete("/watchlist/{symbol:path}")
async def remove_watchlist(
    symbol: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> object:
    result = await session.execute(
        select(Watchlist).where(
            Watchlist.user_id == user.id, Watchlist.symbol == symbol.strip().upper()
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await session.delete(row)
        await session.commit()
    return ok(data={"symbol": symbol.upper()}, message=f"Removed {symbol.upper()}")


# --- Account / positions / orders ----------------------------------------
async def _account_snapshot(session: AsyncSession, account) -> dict:
    positions = await positions_for(session, account.id)
    marked = []
    positions_value = 0.0
    for p in positions:
        q = await get_quote(p.symbol)
        last = float(q["price"])
        market_value = round(last * p.quantity, 2)
        unrealized = round((last - p.avg_price) * p.quantity, 2)
        positions_value += market_value
        marked.append({
            "symbol": p.symbol,
            "quantity": p.quantity,
            "avg_price": round(p.avg_price, 2),
            "last": last,
            "market_value": market_value,
            "unrealized_pnl": unrealized,
            "unrealized_pct": round(((last / p.avg_price) - 1) * 100, 2) if p.avg_price else 0.0,
        })
    equity = round(account.cash + positions_value, 2)
    return {
        "mode": account.mode,
        "cash": round(account.cash, 2),
        "positions_value": round(positions_value, 2),
        "equity": equity,
        "locked": account.locked,
        "risk_per_trade_pct": account.risk_per_trade_pct,
        "max_daily_loss_pct": account.max_daily_loss_pct,
        "positions": marked,
        "live_trading_enabled": get_settings().live_trading_enabled,
    }


@router.get("/account")
async def account(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> object:
    acct = await _account(session, user)
    await session.commit()
    return ok(data=await _account_snapshot(session, acct), message="Account")


@router.post("/account/settings")
async def account_settings(
    payload: AccountSettingsRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> object:
    acct = await _account(session, user)
    if payload.reset:
        for p in await positions_for(session, acct.id):
            await session.delete(p)
        acct.cash = get_settings().paper_starting_cash
        acct.locked = False
    if payload.risk_per_trade_pct is not None:
        acct.risk_per_trade_pct = payload.risk_per_trade_pct
    if payload.max_daily_loss_pct is not None:
        acct.max_daily_loss_pct = payload.max_daily_loss_pct
    await session.commit()
    return ok(data=await _account_snapshot(session, acct), message="Account updated")


@router.post("/orders")
async def place_order(
    payload: OrderRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> object:
    bad = _unknown_symbol(payload.symbol)
    if bad:
        return bad
    acct = await _account(session, user)
    broker = select_broker(get_settings(), acct.mode)
    try:
        fill = await broker.place_order(
            session, acct, payload.symbol, payload.side, payload.quantity, payload.note
        )
    except OrderError as exc:
        await session.rollback()
        return error(str(exc), code="order_rejected")
    await session.commit()
    snap = await _account_snapshot(session, acct)
    return ok(
        data={
            "order": {
                "id": fill.order.id,
                "symbol": fill.order.symbol,
                "side": fill.order.side,
                "quantity": fill.order.quantity,
                "price": round(fill.order.price, 2),
                "realized_pnl": fill.order.realized_pnl,
                "status": fill.order.status,
            },
            "account": snap,
        },
        message=f"{payload.side.title()} {payload.quantity:g} {payload.symbol.upper()} filled",
    )


@router.get("/orders")
async def order_history(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> object:
    result = await session.execute(
        select(TradingOrder)
        .where(TradingOrder.user_id == user.id)
        .order_by(TradingOrder.created_at.desc())
        .limit(100)
    )
    orders = [
        {
            "id": o.id, "symbol": o.symbol, "side": o.side, "quantity": o.quantity,
            "price": round(o.price, 2), "realized_pnl": o.realized_pnl,
            "status": o.status, "created_at": o.created_at.isoformat() if o.created_at else None,
        }
        for o in result.scalars().all()
    ]
    return ok(data={"orders": orders}, message="Order history")


# --- AI: analysis, screener, sizing --------------------------------------
@router.get("/analyze/{symbol:path}")
async def analyze(
    symbol: str,
    timeframe: str = Query(default="1d"),
    _: User = Depends(get_current_user),
) -> object:
    if timeframe not in TIMEFRAMES:
        timeframe = "1d"
    bad = _unknown_symbol(symbol)
    if bad:
        return bad
    series = await get_candles(symbol, timeframe, 200)
    daily = series if timeframe == "1d" else await get_candles(symbol, "1d", 60)
    result = await trade_ai.analyze_chart(symbol.upper(), series, timeframe, daily=daily)
    return ok(data=result, message="Analysis complete")


@router.post("/screen")
async def screen(payload: ScreenRequest, _: User = Depends(get_current_user)) -> object:
    universe = [s.strip().upper() for s in payload.symbols if s.strip()] or DEFAULT_UNIVERSE
    if get_settings().market_data_provider != "alpaca":
        universe = [s for s in universe if symbols.is_known(s)] or DEFAULT_UNIVERSE
    candidates = []
    for sym in universe[:30]:
        series = await get_candles(sym, "1d", 200)
        candidates.append({"symbol": sym, "indicators": ta.indicators(series)})
    return ok(data=trade_ai.screen(payload.query, candidates), message="Screen complete")


@router.post("/position-size")
async def position_size(
    payload: PositionSizeRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> object:
    acct = await _account(session, user)
    await session.commit()
    snap = await _account_snapshot(session, acct)
    equity = payload.equity if payload.equity is not None else snap["equity"]
    plan = ta.position_plan(
        equity=equity, entry=payload.entry, stop=payload.stop, risk_pct=payload.risk_pct
    )
    plan["equity"] = round(equity, 2)
    plan["disclaimer"] = trade_ai.DISCLAIMER
    return ok(data=plan, message="Position plan")


# --- Trade journal + AI coach --------------------------------------------
@router.get("/journal")
async def list_journal(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> object:
    result = await session.execute(
        select(TradeJournalEntry)
        .where(TradeJournalEntry.user_id == user.id)
        .order_by(TradeJournalEntry.created_at.desc())
        .limit(100)
    )
    entries = [_journal_dict(e) for e in result.scalars().all()]
    return ok(data={"entries": entries}, message="Journal")


@router.post("/journal")
async def add_journal(
    payload: JournalRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> object:
    pnl = None
    if payload.entry_price and payload.exit_price and payload.quantity:
        direction = 1 if payload.side.lower() == "buy" else -1
        pnl = round((payload.exit_price - payload.entry_price) * payload.quantity * direction, 2)
    entry = TradeJournalEntry(
        user_id=user.id, symbol=payload.symbol.strip().upper(), side=payload.side.lower(),
        entry_price=payload.entry_price, exit_price=payload.exit_price,
        stop_price=payload.stop_price, quantity=payload.quantity, pnl=pnl,
        thesis=payload.thesis, emotion=payload.emotion, tags=payload.tags,
    )
    session.add(entry)
    await session.commit()
    return ok(data=_journal_dict(entry), message="Trade logged")


@router.post("/journal/{entry_id}/review")
async def review_journal(
    entry_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> object:
    entry = await session.get(TradeJournalEntry, entry_id)
    if entry is None or entry.user_id != user.id:
        return error("Journal entry not found.", status_code=404, code="not_found")
    review = await trade_ai.review_trade(_journal_dict(entry))
    entry.ai_review = review["feedback"]
    await session.commit()
    return ok(data={"entry": _journal_dict(entry), **review}, message="Review complete")


@router.delete("/journal/{entry_id}")
async def delete_journal(
    entry_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> object:
    entry = await session.get(TradeJournalEntry, entry_id)
    if entry is not None and entry.user_id == user.id:
        await session.delete(entry)
        await session.commit()
    return ok(data={"id": entry_id}, message="Deleted")


# --- Performance dashboard ------------------------------------------------
@router.get("/stats")
async def stats(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> object:
    # Realized trades = closing orders that carry realized P&L.
    result = await session.execute(
        select(TradingOrder).where(
            TradingOrder.user_id == user.id, TradingOrder.realized_pnl.is_not(None)
        )
    )
    closes = list(result.scalars().all())
    pnls = [float(o.realized_pnl) for o in closes]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    n = len(pnls)
    gross_win = round(sum(wins), 2)
    gross_loss = round(sum(losses), 2)
    by_symbol: dict[str, float] = {}
    for o in closes:
        by_symbol[o.symbol] = round(by_symbol.get(o.symbol, 0.0) + float(o.realized_pnl), 2)

    # Realized reward:risk from journalled trades that have entry/stop/exit.
    jres = await session.execute(
        select(TradeJournalEntry).where(TradeJournalEntry.user_id == user.id)
    )
    rrs = []
    for e in jres.scalars().all():
        if e.entry_price and e.stop_price and e.exit_price and e.entry_price != e.stop_price:
            rrs.append(abs(e.exit_price - e.entry_price) / abs(e.entry_price - e.stop_price))

    best = max(by_symbol.items(), key=lambda kv: kv[1], default=(None, None))
    worst = min(by_symbol.items(), key=lambda kv: kv[1], default=(None, None))
    data = {
        "trades": n,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / n * 100, 1) if n else 0.0,
        "total_pnl": round(sum(pnls), 2),
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0.0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0.0,
        "profit_factor": round(gross_win / abs(gross_loss), 2) if gross_loss else (None if not wins else 999.0),
        "expectancy": round(sum(pnls) / n, 2) if n else 0.0,
        "avg_reward_risk": round(sum(rrs) / len(rrs), 2) if rrs else None,
        "best_symbol": {"symbol": best[0], "pnl": best[1]} if best[0] else None,
        "worst_symbol": {"symbol": worst[0], "pnl": worst[1]} if worst[0] else None,
    }
    return ok(data=data, message="Performance")


# --- AI risk monitor ------------------------------------------------------
@router.get("/risk-check")
async def risk_check(
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> object:
    """Rules-based guardrails over recent activity: overtrading, revenge trading,
    position concentration, and poor reward:risk. Educational nudges, not advice."""
    result = await session.execute(
        select(TradingOrder).where(TradingOrder.user_id == user.id)
        .order_by(TradingOrder.created_at.desc()).limit(40)
    )
    orders = list(result.scalars().all())  # newest first
    warnings: list[dict] = []
    now = datetime.now(timezone.utc)

    def _aware(dt):
        # SQLite hands back naive datetimes; assume UTC so tz math is safe.
        return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    recent = [o for o in orders if o.created_at and (now - _aware(o.created_at)) <= timedelta(minutes=60)]
    if len(recent) >= 6:
        warnings.append({"type": "overtrading", "level": "warn",
                         "message": f"You've placed {len(recent)} orders in the last hour — that pace often signals overtrading."})

    # Revenge trading: a new order within 10 min after a losing close.
    chrono = sorted([o for o in orders if o.created_at], key=lambda o: _aware(o.created_at))
    revenge = 0
    for i in range(1, len(chrono)):
        prev = chrono[i - 1]
        if prev.realized_pnl is not None and prev.realized_pnl < 0 and \
           (_aware(chrono[i].created_at) - _aware(prev.created_at)) <= timedelta(minutes=10):
            revenge += 1
    if revenge >= 2:
        warnings.append({"type": "revenge_trading", "level": "warn",
                         "message": f"{revenge} of your recent entries came right after a loss — watch for revenge trading."})

    # Position concentration vs equity.
    acct = await _account(session, user)
    await session.commit()
    snap = await _account_snapshot(session, acct)
    eq = snap["equity"] or 1
    for p in snap["positions"]:
        pctv = p["market_value"] / eq * 100
        if pctv >= 30:
            warnings.append({"type": "oversizing", "level": "warn",
                             "message": f"{p['symbol']} is {pctv:.0f}% of your equity — concentrated risk in one name."})

    # Poor reward:risk from journalled trades.
    jres = await session.execute(
        select(TradeJournalEntry).where(TradeJournalEntry.user_id == user.id)
        .order_by(TradeJournalEntry.created_at.desc()).limit(10)
    )
    for e in jres.scalars().all():
        if e.entry_price and e.stop_price and e.exit_price and e.entry_price != e.stop_price:
            rr = abs(e.exit_price - e.entry_price) / abs(e.entry_price - e.stop_price)
            if rr < 1:
                warnings.append({"type": "poor_rr", "level": "info",
                                 "message": f"Your {e.symbol} trade risked more than it aimed to make (R:R {rr:.2f})."})
                break

    return ok(data={"ok": not warnings, "warnings": warnings}, message="Risk check")


# --- Market Challenge (historical replay game) ---------------------------
@router.get("/challenge/new")
async def challenge_new(
    symbol: str = Query(default=""),
    timeframe: str = Query(default="1d"),
    _: User = Depends(get_current_user),
) -> object:
    if timeframe not in TIMEFRAMES:
        timeframe = "1d"
    sym = symbol.strip().upper() if symbol.strip() else random.choice([s["symbol"] for s in symbols.all_symbols()])
    bad = _unknown_symbol(sym)
    if bad:
        return bad
    candles = await get_candles(sym, timeframe, 250)
    game = challenge.build_challenge(sym, timeframe, candles)
    if game is None:
        return error("Not enough history to build a challenge for that symbol.", code="no_history")
    # Hide the company name so it's a blind read (name revealed on answer).
    return ok(
        data={
            "symbol": game["symbol"], "timeframe": game["timeframe"],
            "setup": game["setup"], "entry": game["entry"],
            "horizon": game["horizon"], "token": game["token"],
        },
        message="New challenge",
    )


@router.post("/challenge/answer")
async def challenge_answer(
    payload: ChallengeAnswerRequest, _: User = Depends(get_current_user)
) -> object:
    data = challenge.verify_token(payload.token)
    if data is None:
        return error("Invalid or expired challenge. Start a new one.", code="bad_token")
    candles = await get_candles(data["symbol"], data["timeframe"], 250)
    result = challenge.score_challenge(data, payload.choice, candles)
    if result is None:
        return error("Couldn't score that challenge — start a new one.", code="expired")
    result["symbol"] = data["symbol"]
    result["name"] = symbols.name_for(data["symbol"])
    return ok(data=result, message="Challenge scored")


# --- Academy --------------------------------------------------------------
@router.get("/academy")
async def academy(_: User = Depends(get_current_user)) -> object:
    return ok(data={"modules": CURRICULUM}, message="Trading Academy")


def _journal_dict(e: TradeJournalEntry) -> dict:
    return {
        "id": e.id, "symbol": e.symbol, "side": e.side,
        "entry_price": e.entry_price, "exit_price": e.exit_price,
        "stop_price": e.stop_price, "quantity": e.quantity, "pnl": e.pnl,
        "thesis": e.thesis, "emotion": e.emotion, "tags": e.tags or [],
        "ai_review": e.ai_review,
        "created_at": e.created_at.isoformat() if e.created_at else None,
    }
