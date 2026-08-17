"""
Technical analysis — pure, deterministic indicators over an OHLCV series.

No AI and no network: these are the numbers a chart is built from (SMA/EMA/RSI,
MACD, ATR, swing-based support/resistance, trend read) plus the risk math that
powers the position sizer. Keeping this layer pure means the platform gives real,
correct output even when Groq is unconfigured — the AI narrative in `trade_ai.py`
is layered *on top* of these facts, never a substitute for them.

A "series" here is the list of bar dicts from `market_data.get_candles`.
"""

from __future__ import annotations

from statistics import mean


def closes(series: list[dict]) -> list[float]:
    return [float(b["c"]) for b in series]


def sma(values: list[float], period: int) -> float | None:
    if len(values) < period or period <= 0:
        return None
    return round(mean(values[-period:]), 4)


def ema(values: list[float], period: int) -> float | None:
    if len(values) < period or period <= 0:
        return None
    k = 2 / (period + 1)
    e = mean(values[:period])
    for v in values[period:]:
        e = v * k + e * (1 - k)
    return round(e, 4)


def rsi(values: list[float], period: int = 14) -> float | None:
    """Wilder's RSI. Returns 0–100, or None if there isn't enough data."""
    if len(values) <= period:
        return None
    gains, losses = [], []
    for i in range(1, len(values)):
        diff = values[i] - values[i - 1]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))
    avg_gain = mean(gains[:period])
    avg_loss = mean(losses[:period])
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def macd(values: list[float]) -> dict | None:
    """Classic 12/26/9 MACD. Returns {macd, signal, hist} or None."""
    if len(values) < 35:
        return None
    # Build the MACD line series so its 9-period EMA (signal) is meaningful.
    line: list[float] = []
    for i in range(26, len(values) + 1):
        window = values[:i]
        fast, slow = ema(window, 12), ema(window, 26)
        if fast is None or slow is None:
            continue
        line.append(fast - slow)
    if len(line) < 9:
        return None
    signal = ema(line, 9)
    if signal is None:
        return None
    return {"macd": round(line[-1], 4), "signal": round(signal, 4),
            "hist": round(line[-1] - signal, 4)}


def atr(series: list[dict], period: int = 14) -> float | None:
    """Average True Range — the volatility unit for stops/targets."""
    if len(series) <= period:
        return None
    trs: list[float] = []
    for i in range(1, len(series)):
        h, low = float(series[i]["h"]), float(series[i]["l"])
        prev_c = float(series[i - 1]["c"])
        trs.append(max(h - low, abs(h - prev_c), abs(low - prev_c)))
    return round(mean(trs[-period:]), 4)


def support_resistance(series: list[dict], lookback: int = 40) -> dict:
    """Swing-based nearest support/resistance around the current price."""
    window = series[-lookback:] if len(series) > lookback else series
    if not window:
        return {"support": None, "resistance": None}
    highs = [float(b["h"]) for b in window]
    lows = [float(b["l"]) for b in window]
    price = float(window[-1]["c"])
    below = [l for l in lows if l < price]
    above = [h for h in highs if h > price]
    return {
        "support": round(max(below), 2) if below else round(min(lows), 2),
        "resistance": round(min(above), 2) if above else round(max(highs), 2),
    }


def trend(values: list[float]) -> str:
    """A plain-language trend read from the 20/50 SMA relationship + slope."""
    s20, s50 = sma(values, 20), sma(values, 50)
    if s20 is None or s50 is None:
        s_short = sma(values, min(5, len(values)))
        s_long = sma(values, min(20, len(values)))
        if s_short is None or s_long is None:
            return "unknown"
        return "up" if s_short >= s_long else "down"
    if s20 > s50 * 1.002:
        return "up"
    if s20 < s50 * 0.998:
        return "down"
    return "sideways"


def indicators(series: list[dict]) -> dict:
    """A compact snapshot of everything the analysis + screener rely on."""
    cs = closes(series)
    if not cs:
        return {}
    price = cs[-1]
    sr = support_resistance(series)
    return {
        "price": round(price, 2),
        "sma20": sma(cs, 20),
        "sma50": sma(cs, 50),
        "sma200": sma(cs, 200),
        "ema9": ema(cs, 9),
        "ema21": ema(cs, 21),
        "rsi14": rsi(cs, 14),
        "macd": macd(cs),
        "atr14": atr(series, 14),
        "support": sr["support"],
        "resistance": sr["resistance"],
        "trend": trend(cs),
        "change_pct_20": round(((price / cs[-21]) - 1) * 100, 2) if len(cs) > 21 else None,
    }


# --------------------------------------------------------------------------- #
# Risk / position sizing — the beginner guardrail                             #
# --------------------------------------------------------------------------- #
def position_plan(
    *,
    equity: float,
    entry: float,
    stop: float,
    risk_pct: float,
    targets_r: tuple[float, ...] = (1.0, 2.0, 3.0),
) -> dict:
    """Turn a risk tolerance into concrete size and reward levels.

    Given account equity, an entry, a protective stop, and the % of equity the
    trader will risk, compute share count, dollars at risk, notional, and the
    price levels for a set of reward:risk multiples. This is the math that keeps
    a new trader from blowing up — it is intentionally rules-based, not AI.
    """
    risk_pct = max(0.01, min(risk_pct, 100.0))
    risk_per_share = abs(entry - stop)
    long = entry >= stop
    if risk_per_share <= 0 or equity <= 0 or entry <= 0:
        return {
            "valid": False,
            "reason": "Entry and stop must differ and be positive.",
            "shares": 0, "risk_amount": 0.0, "notional": 0.0,
            "risk_per_share": round(risk_per_share, 4), "direction": "long" if long else "short",
            "targets": [],
        }
    risk_amount = equity * (risk_pct / 100)
    shares = int(risk_amount // risk_per_share)
    notional = round(shares * entry, 2)
    targets = []
    for r in targets_r:
        move = risk_per_share * r
        tgt = entry + move if long else entry - move
        targets.append({
            "r": r,
            "price": round(tgt, 2),
            "profit": round(shares * move, 2),
        })
    return {
        "valid": shares > 0,
        "reason": "" if shares > 0 else "Risk too small for one share at this stop distance.",
        "direction": "long" if long else "short",
        "risk_per_share": round(risk_per_share, 4),
        "risk_amount": round(risk_amount, 2),
        "shares": shares,
        "notional": notional,
        "pct_of_equity": round((notional / equity) * 100, 1) if equity else 0.0,
        "targets": targets,
    }


# --------------------------------------------------------------------------- #
# Market structure — swing pivots, HH/HL/LH/LL, trend event                   #
# --------------------------------------------------------------------------- #
def _pivots(series: list[dict], k: int = 2) -> tuple[list[dict], list[dict]]:
    """Fractal swing highs/lows: a bar whose high (low) exceeds its k neighbours
    on both sides. Returns (swing_highs, swing_lows) as [{index, price}]."""
    highs, lows = [], []
    n = len(series)
    for i in range(k, n - k):
        h = float(series[i]["h"])
        low = float(series[i]["l"])
        if all(h >= float(series[j]["h"]) for j in range(i - k, i + k + 1)) and \
           any(h > float(series[j]["h"]) for j in range(i - k, i + k + 1) if j != i):
            highs.append({"index": i, "price": round(h, 2)})
        if all(low <= float(series[j]["l"]) for j in range(i - k, i + k + 1)) and \
           any(low < float(series[j]["l"]) for j in range(i - k, i + k + 1) if j != i):
            lows.append({"index": i, "price": round(low, 2)})
    return highs, lows


def market_structure(series: list[dict]) -> dict:
    """Classify market structure from swing pivots: the last two swing highs give
    HH (higher high) or LH (lower high); the last two swing lows give HL or LL.
    Structure is bullish on HH+HL, bearish on LH+LL, else ranging. Also reports a
    current event (breakout / breakdown / pullback / consolidation)."""
    highs, lows = _pivots(series)
    labels: list[str] = []
    hi_lbl = lo_lbl = None
    if len(highs) >= 2:
        hi_lbl = "HH" if highs[-1]["price"] > highs[-2]["price"] else "LH"
        labels.append(hi_lbl)
    if len(lows) >= 2:
        lo_lbl = "HL" if lows[-1]["price"] > lows[-2]["price"] else "LL"
        labels.append(lo_lbl)

    if hi_lbl == "HH" and lo_lbl == "HL":
        structure = "bullish"
    elif hi_lbl == "LH" and lo_lbl == "LL":
        structure = "bearish"
    else:
        structure = "ranging"

    price = float(series[-1]["c"])
    last_high = highs[-1]["price"] if highs else max(float(b["h"]) for b in series)
    last_low = lows[-1]["price"] if lows else min(float(b["l"]) for b in series)

    # Recent event relative to the latest swing structure.
    atr14 = atr(series, 14) or (price * 0.01)
    if price > last_high:
        event = "breakout"
    elif price < last_low:
        event = "breakdown"
    else:
        span = last_high - last_low
        if span > 0 and span < atr14 * 3:
            event = "consolidation"
        elif structure == "bullish" and price < (last_high - atr14):
            event = "pullback"
        elif structure == "bearish" and price > (last_low + atr14):
            event = "pullback"
        else:
            event = "in-range"

    return {
        "structure": structure,
        "labels": labels,                 # e.g. ["HH", "HL"]
        "swing_high": round(last_high, 2),
        "swing_low": round(last_low, 2),
        "event": event,
        "swing_high_count": len(highs),
        "swing_low_count": len(lows),
    }


def session_context(daily: list[dict]) -> dict:
    """Prior-day high/low and opening gap from a daily series (oldest→newest)."""
    if len(daily) < 2:
        return {"prev_high": None, "prev_low": None, "prev_close": None, "gap_pct": None}
    prev, last = daily[-2], daily[-1]
    prev_close = float(prev["c"])
    gap = round(((float(last["o"]) - prev_close) / prev_close) * 100, 2) if prev_close else None
    return {
        "prev_high": round(float(prev["h"]), 2),
        "prev_low": round(float(prev["l"]), 2),
        "prev_close": round(prev_close, 2),
        "gap_pct": gap,
    }
