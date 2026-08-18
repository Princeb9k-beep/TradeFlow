"""
Market Challenge — the historical-replay learning game.

Show the trader a chart up to a hidden point, ask BUY / SELL / WAIT, then reveal
the next N bars and score the decision. Stateless: the cutoff is encoded in a
signed token (JWT with the app secret) rather than a DB row, so scoring on submit
just re-derives the same deterministic/historical window and reads the future.

Scoring rewards being directionally right AND disciplined — WAIT is the correct
answer when there was no real move, so patience is graded, not punished.
"""

from __future__ import annotations

import random

import jwt

from ..config import get_settings

_ALG = "HS256"
_THRESHOLD = 0.5   # % move that counts as a real directional move
LOOKBACK = 60
HORIZON = 10
_TIERS = (("Elite", 85), ("Gold", 70), ("Silver", 55), ("Bronze", 0))


def _sign(data: dict) -> str:
    return jwt.encode({**data, "purpose": "challenge"}, get_settings().app_secret_key, algorithm=_ALG)


def verify_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, get_settings().app_secret_key, algorithms=[_ALG])
    except jwt.InvalidTokenError:
        return None
    return payload if payload.get("purpose") == "challenge" else None


def build_challenge(symbol: str, timeframe: str, candles: list[dict]) -> dict | None:
    """Pick a random cutoff that leaves a lookback window and a hidden future."""
    n = len(candles)
    if n < LOOKBACK + HORIZON + 5:
        return None
    cutoff = random.randint(LOOKBACK, n - HORIZON - 1)
    setup = candles[cutoff - LOOKBACK + 1: cutoff + 1]
    entry = round(float(candles[cutoff]["c"]), 2)
    token = _sign({
        "symbol": symbol, "timeframe": timeframe,
        "cutoff_time": candles[cutoff]["t"], "horizon": HORIZON, "entry": entry,
    })
    return {
        "symbol": symbol, "timeframe": timeframe, "setup": setup,
        "entry": entry, "horizon": HORIZON, "token": token,
    }


def _tier(score: int) -> str:
    for name, floor in _TIERS:
        if score >= floor:
            return name
    return "Bronze"


def score_challenge(payload: dict, choice: str, candles: list[dict]) -> dict | None:
    """Reveal the hidden bars and grade the BUY/SELL/WAIT decision."""
    choice = choice.lower()
    if choice not in {"buy", "sell", "wait"}:
        return None
    cutoff_time = payload["cutoff_time"]
    idx = next((i for i, b in enumerate(candles) if b["t"] == cutoff_time), None)
    if idx is None or idx + 1 >= len(candles):
        return None
    horizon = int(payload["horizon"])
    entry = float(payload["entry"])
    future = candles[idx + 1: idx + 1 + horizon]
    if not future:
        return None

    final = float(future[-1]["c"])
    highs = [float(b["h"]) for b in future]
    lows = [float(b["l"]) for b in future]
    move = (final - entry) / entry * 100
    mfe = (max(highs) - entry) / entry * 100   # best case for a long
    mae = (min(lows) - entry) / entry * 100    # worst case for a long

    if choice == "buy":
        correct = move > _THRESHOLD
    elif choice == "sell":
        correct = move < -_THRESHOLD
    else:
        correct = abs(move) <= _THRESHOLD

    if choice == "wait":
        score = 72 if correct else max(15, 45 - abs(move) * 4)
    elif correct:
        score = min(100, 60 + min(40, abs(move) * 8))
    else:
        score = max(10, 45 - abs(move) * 6)
    score = round(score)

    label = {"buy": "BUY (long)", "sell": "SELL (short)", "wait": "WAIT"}[choice]
    verdict = "Nice read." if correct else "Not this time."
    if choice == "wait" and correct:
        verdict = "Good discipline — there was no real edge."
    explanation = (
        f"Over the next {len(future)} bars, price moved {move:+.2f}% "
        f"(best case +{mfe:.2f}%, worst {mae:.2f}%). You chose {label} — {verdict}"
    )
    return {
        "choice": choice, "correct": correct,
        "move_pct": round(move, 2), "mfe_pct": round(mfe, 2), "mae_pct": round(mae, 2),
        "entry": round(entry, 2), "final": round(final, 2),
        "score": score, "tier": _tier(score),
        "explanation": explanation, "future": future,
    }
