"""
AI trading brain — the layer that makes this "special" versus a plain chart.

Three tasks, each built on the deterministic facts from `ta.py`:

  * analyze_chart  — a plain-language read of the setup (bias, key levels, a
    risk note) for the symbol on screen.
  * screen         — a natural-language screener: "oversold large-caps reclaiming
    the 200-day" -> ranked matches, instead of clicking twelve filter boxes.
  * review_trade   — the AI Trading Coach: feedback on a journalled trade, flagging
    process mistakes (no stop, oversized risk, revenge trading, no thesis).

Every task degrades gracefully: if Groq is unconfigured or errors, a rules-based
fallback derived from the indicators is returned, so the feature never dies — it
just loses the natural-language polish. Nothing here is investment advice, and
each payload carries a disclaimer the UI surfaces.
"""

from __future__ import annotations

from ..groq_client import generate
from . import ta

DISCLAIMER = (
    "Educational analysis only — not financial advice. Markets are risky; you can "
    "lose money. Do your own research and never risk more than you can afford to lose."
)


# --------------------------------------------------------------------------- #
# 1. Chart analysis                                                           #
# --------------------------------------------------------------------------- #
def _rules_bias(ind: dict) -> tuple[str, list[str]]:
    """A deterministic bias + bullet reasons straight from the indicators."""
    reasons: list[str] = []
    score = 0
    trend = ind.get("trend")
    if trend == "up":
        score += 1; reasons.append("Uptrend: 20-day SMA above the 50-day.")
    elif trend == "down":
        score -= 1; reasons.append("Downtrend: 20-day SMA below the 50-day.")
    rsi = ind.get("rsi14")
    if rsi is not None:
        if rsi >= 70:
            score -= 1; reasons.append(f"RSI {rsi} is overbought (>70) — stretched.")
        elif rsi <= 30:
            score += 1; reasons.append(f"RSI {rsi} is oversold (<30) — possible bounce.")
        else:
            reasons.append(f"RSI {rsi} is neutral.")
    macd = ind.get("macd")
    if macd:
        if macd["hist"] > 0:
            score += 1; reasons.append("MACD histogram positive (momentum up).")
        else:
            score -= 1; reasons.append("MACD histogram negative (momentum down).")
    price, sma200 = ind.get("price"), ind.get("sma200")
    if price and sma200:
        if price > sma200:
            reasons.append("Price is above the 200-day (long-term bullish).")
        else:
            reasons.append("Price is below the 200-day (long-term bearish).")
    bias = "bullish" if score > 0 else "bearish" if score < 0 else "neutral"
    return bias, reasons


def _confidence(ind: dict, structure: dict) -> tuple[str, int, list[str]]:
    """Directional score → (bias, confidence 50-95, aligned-signal reasons)."""
    score = 0
    reasons: list[str] = []
    if ind.get("trend") == "up":
        score += 1; reasons.append("Uptrend (20>50 SMA)")
    elif ind.get("trend") == "down":
        score -= 1; reasons.append("Downtrend (20<50 SMA)")
    if structure.get("structure") == "bullish":
        score += 1; reasons.append(f"Bullish structure ({'/'.join(structure.get('labels', [])) or 'HH/HL'})")
    elif structure.get("structure") == "bearish":
        score -= 1; reasons.append(f"Bearish structure ({'/'.join(structure.get('labels', [])) or 'LH/LL'})")
    rsi = ind.get("rsi14")
    if rsi is not None:
        if rsi <= 30:
            score += 1; reasons.append(f"RSI {rsi} oversold")
        elif rsi >= 70:
            score -= 1; reasons.append(f"RSI {rsi} overbought")
    macd = ind.get("macd")
    if macd:
        if macd["hist"] > 0:
            score += 1; reasons.append("MACD momentum up")
        else:
            score -= 1; reasons.append("MACD momentum down")
    price, sma200 = ind.get("price"), ind.get("sma200")
    if price and sma200:
        if price > sma200:
            score += 1; reasons.append("Above the 200-day")
        else:
            score -= 1; reasons.append("Below the 200-day")
    if structure.get("event") == "breakout":
        score += 1; reasons.append("Breakout over swing high")
    elif structure.get("event") == "breakdown":
        score -= 1; reasons.append("Breakdown under swing low")

    bias = "bullish" if score > 0 else "bearish" if score < 0 else "neutral"
    confidence = min(95, 50 + round(abs(score) / 6 * 45))
    return bias, confidence, reasons


def _trade_plan(ind: dict, structure: dict, bias: str) -> dict:
    """Educational entry/stop/target zones + reward:risk. NOT a signal."""
    price = ind.get("price")
    atr = ind.get("atr14") or (price * 0.01 if price else 1)
    support = ind.get("support")
    resistance = ind.get("resistance")
    if not price:
        return {"setup": "insufficient data"}
    if bias == "bullish":
        entry = price
        stop = round(min(support or price, structure.get("swing_low", price)) - 0.25 * atr, 2)
        target = round(max(resistance or price, entry + 2 * (entry - stop)), 2)
        direction = "long"
    elif bias == "bearish":
        entry = price
        stop = round(max(resistance or price, structure.get("swing_high", price)) + 0.25 * atr, 2)
        target = round(min(support or price, entry - 2 * (stop - entry)), 2)
        direction = "short"
    else:
        return {"setup": "no edge — wait for a cleaner structure", "direction": "flat",
                "entry": None, "stop": None, "target": None, "reward_risk": None}
    risk = abs(entry - stop)
    reward = abs(target - entry)
    rr = round(reward / risk, 2) if risk else None
    setup = structure.get("event", "in-range")
    return {"setup": setup, "direction": direction, "entry": round(entry, 2),
            "stop": stop, "target": target, "reward_risk": rr}


def _verify_checklist(ind: dict, structure: dict, bias: str) -> list[str]:
    """'How to verify it yourself' — this is a learning tool, not a black box."""
    items = [
        "Confirm the same trend on a higher timeframe before acting.",
        "Mark the support/resistance yourself and check price actually reacted there.",
    ]
    if structure.get("event") in ("breakout", "breakdown"):
        items.append("On a break, require volume to expand — a low-volume break often fails.")
    if bias != "neutral":
        items.append("Place your stop beyond the swing "
                     + ("low" if bias == "bullish" else "high") + ", not at a round number.")
    items.append("Size the position so the stop loss is ≤ your max risk per trade.")
    return items


async def analyze_chart(symbol: str, series: list[dict], timeframe: str, daily: list[dict] | None = None) -> dict:
    """AI Chart Coach: structure, key levels, an educational entry/stop/target
    plan, confidence, and a verify-it-yourself checklist. Framed as analysis for
    learning — never a guaranteed signal."""
    ind = ta.indicators(series)
    structure = ta.market_structure(series)
    session = ta.session_context(daily) if daily else {"prev_high": None, "prev_low": None, "prev_close": None, "gap_pct": None}
    levels = {"support": ind.get("support"), "resistance": ind.get("resistance")}
    bias, confidence, aligned = _confidence(ind, structure)
    plan = _trade_plan(ind, structure, bias)
    verify = _verify_checklist(ind, structure, bias)

    summary = (
        f"Market structure is {structure['structure']} "
        f"({'/'.join(structure.get('labels', [])) or 'forming'}), event: {structure['event']}. "
        f"Bias {bias} at ~{confidence}% confidence. "
        + (" ".join(aligned) + "." if aligned else "")
    )
    try:
        prompt = (
            f"You are a trading COACH teaching a student. Symbol {symbol}, {timeframe} timeframe.\n"
            f"Computed facts (ground truth): indicators={ind}; structure={structure}; "
            f"session={session}; bias={bias}; confidence={confidence}; plan={plan}.\n\n"
            "In 3-5 sentences, explain what the chart is showing (trend, market structure "
            "with HH/HL/LH/LL, key levels, momentum) and the potential setup, in teaching "
            "language. Frame the entry/stop/target as an EXAMPLE of how one might structure "
            "risk, not a recommendation. End by reminding the student to verify it themselves. "
            "No guarantees, no 'you should buy/sell'."
        )
        text = await generate(prompt, system="You are a supportive trading coach for a learner. Educational only; never financial advice.", max_tokens=380, temperature=0.4)
        if text.strip():
            summary = text.strip()
    except Exception:  # noqa: BLE001 - keep the rules-based summary
        pass

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "indicators": ind,
        "structure": structure,
        "session": session,
        "bias": bias,
        "confidence": confidence,
        "reasons": aligned,
        "levels": levels,
        "plan": plan,
        "summary": summary,
        "verify": verify,
        "disclaimer": DISCLAIMER,
    }


# --------------------------------------------------------------------------- #
# 2. Natural-language screener                                                #
# --------------------------------------------------------------------------- #
def _parse_filters(query: str) -> dict:
    """Heuristic NL -> filter parse (works with no AI)."""
    q = query.lower()
    f: dict = {}
    if "oversold" in q:
        f["rsi_max"] = 35
    if "overbought" in q:
        f["rsi_min"] = 65
    if "uptrend" in q or "trending up" in q or "bullish" in q:
        f["trend"] = "up"
    if "downtrend" in q or "trending down" in q or "bearish" in q:
        f["trend"] = "down"
    if "above the 200" in q or "above 200" in q or "reclaim" in q:
        f["above_sma200"] = True
    if "below the 200" in q or "below 200" in q:
        f["above_sma200"] = False
    if "momentum" in q or "macd" in q:
        f["macd_positive"] = True
    return f


def _matches(ind: dict, f: dict) -> bool:
    rsi = ind.get("rsi14")
    if "rsi_max" in f and (rsi is None or rsi > f["rsi_max"]):
        return False
    if "rsi_min" in f and (rsi is None or rsi < f["rsi_min"]):
        return False
    if "trend" in f and ind.get("trend") != f["trend"]:
        return False
    if "above_sma200" in f:
        price, s200 = ind.get("price"), ind.get("sma200")
        if price is None or s200 is None:
            return False
        if f["above_sma200"] and price < s200:
            return False
        if not f["above_sma200"] and price > s200:
            return False
    if f.get("macd_positive"):
        macd = ind.get("macd")
        if not macd or macd["hist"] <= 0:
            return False
    return True


def screen(query: str, candidates: list[dict]) -> dict:
    """Rank `candidates` (each {"symbol", "indicators"}) against a NL query.

    Deterministic and offline: the parse is heuristic and the scoring is a
    transparent blend of trend + momentum so results are explainable.
    """
    filters = _parse_filters(query)
    results = []
    for c in candidates:
        ind = c.get("indicators") or {}
        if not ind or not _matches(ind, filters):
            continue
        # Score: reward alignment so the strongest fits float to the top.
        score = 0.0
        if ind.get("trend") == "up":
            score += 2
        elif ind.get("trend") == "down":
            score -= 1
        rsi = ind.get("rsi14")
        if rsi is not None:
            if filters.get("rsi_max"):
                score += (filters["rsi_max"] - rsi) / 10  # more oversold ranks higher
            elif rsi > 70 or rsi < 30:
                score += 1
        macd = ind.get("macd")
        if macd and macd["hist"] > 0:
            score += 1
        results.append({
            "symbol": c["symbol"],
            "price": ind.get("price"),
            "rsi14": rsi,
            "trend": ind.get("trend"),
            "change_pct_20": ind.get("change_pct_20"),
            "score": round(score, 2),
        })
    results.sort(key=lambda r: r["score"], reverse=True)
    return {
        "query": query,
        "filters": filters,
        "count": len(results),
        "results": results[:25],
        "disclaimer": DISCLAIMER,
    }


# --------------------------------------------------------------------------- #
# 3. Trade review (AI Trading Coach)                                          #
# --------------------------------------------------------------------------- #
def _rules_review(entry: dict) -> list[str]:
    notes: list[str] = []
    if not entry.get("stop_price"):
        notes.append("No stop recorded — every trade needs a predefined exit before entry.")
    if not entry.get("thesis"):
        notes.append("No thesis logged — write *why* you took the trade to review it later.")
    ep, sp, qty = entry.get("entry_price"), entry.get("stop_price"), entry.get("quantity")
    if ep and sp and qty:
        risk = abs(ep - sp) * qty
        notes.append(f"Risk on this trade was about ${round(risk, 2)} ({round(abs(ep-sp),2)}/share).")
    xp = entry.get("exit_price")
    if ep and sp and xp:
        rr = abs(xp - ep) / abs(ep - sp) if abs(ep - sp) else 0
        notes.append(f"Realized reward:risk ≈ {round(rr, 2)}R.")
    emo = (entry.get("emotion") or "").lower()
    if emo in {"fomo", "revenge", "greedy", "anxious", "panic"}:
        notes.append(f"You flagged '{emo}' — emotional trades are where accounts leak; size down next time.")
    if not notes:
        notes.append("Clean process. Keep logging trades to build a reviewable track record.")
    return notes


async def review_trade(entry: dict) -> dict:
    """Coach feedback on one journalled trade. AI narrative + rules-based notes."""
    notes = _rules_review(entry)
    feedback = " ".join(notes)
    try:
        prompt = (
            "You are a trading coach reviewing a trader's journalled trade. Be direct "
            "and constructive, focused on PROCESS (risk, stops, sizing, discipline), not "
            "on whether the pick was right. 3-4 sentences.\n\n"
            f"Trade: {entry}\n"
            f"Objective observations: {notes}"
        )
        text = await generate(
            prompt,
            system="You are a supportive but honest trading coach. Never guarantee outcomes.",
            max_tokens=300,
            temperature=0.5,
        )
        if text.strip():
            feedback = text.strip()
    except Exception:  # noqa: BLE001
        pass
    return {"notes": notes, "feedback": feedback, "disclaimer": DISCLAIMER}
