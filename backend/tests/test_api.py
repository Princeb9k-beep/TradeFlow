"""
Smoke tests for the Tradeflow backend.

Runs fully offline: an aiosqlite database is created from the ORM metadata, Redis
is absent (caching no-ops), and Groq is unconfigured (AI falls back to its
rules-based output). Verifies the app boots, the envelope is consistent, and the
core auth + trading flow works end-to-end.

Run:  cd backend && pytest -q
"""

from __future__ import annotations

import os
import pathlib
import sys

_DB = pathlib.Path(__file__).parent / "test.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB}"
os.environ.setdefault("GROQ_API_KEY", "")
# Tests run fully offline and deterministically against the synthetic provider,
# regardless of the app's real-data default.
os.environ["MARKET_DATA_PROVIDER"] = "synthetic"
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import asyncio  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, get_engine  # noqa: E402
import main  # noqa: E402


@pytest.fixture(scope="module")
def client():
    async def _create() -> None:
        async with get_engine().begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_create())
    with TestClient(main.app) as c:
        yield c
    if _DB.exists():
        _DB.unlink()


def _envelope(body: dict) -> None:
    assert set(body.keys()) >= {"success", "data", "message", "meta"}


def _auth(client, email, name="Trader"):
    r = client.post("/auth/signup", json={"email": email, "password": "supersecret", "name": name})
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json()['data']['token']}"}


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    _envelope(body)
    assert body["data"]["services"]["database"] == "up"


def test_signup_login(client):
    r = client.post("/auth/signup", json={"email": "a@example.com", "password": "supersecret", "name": "Ana"})
    assert r.status_code == 201
    _envelope(r.json())
    assert r.json()["data"]["user"]["email"] == "a@example.com"

    dup = client.post("/auth/signup", json={"email": "a@example.com", "password": "supersecret"})
    assert dup.status_code == 409

    login = client.post("/auth/login", json={"email": "a@example.com", "password": "supersecret"})
    assert login.status_code == 200
    token = login.json()["data"]["token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["data"]["email"] == "a@example.com"

    bad = client.post("/auth/login", json={"email": "a@example.com", "password": "nope12345"})
    assert bad.status_code == 401


def test_trading_core_paper_flow(client):
    trader = _auth(client, "trader@example.com")

    r = client.get("/trading/candles/AAPL?timeframe=1d&limit=60", headers=trader)
    assert r.status_code == 200
    candles = r.json()["data"]["candles"]
    assert len(candles) == 60
    assert {"o", "h", "l", "c", "v", "t"} <= set(candles[0].keys())

    r = client.get("/trading/quote/AAPL", headers=trader)
    assert r.status_code == 200 and r.json()["data"]["price"] > 0

    r = client.get("/trading/account", headers=trader)
    assert r.status_code == 200
    start_cash = r.json()["data"]["cash"]
    assert start_cash > 0

    r = client.post("/trading/orders", json={"symbol": "AAPL", "side": "buy", "quantity": 10}, headers=trader)
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["order"]["status"] == "filled"
    assert body["account"]["cash"] < start_cash
    assert any(p["symbol"] == "AAPL" and p["quantity"] == 10 for p in body["account"]["positions"])

    r = client.post("/trading/orders", json={"symbol": "AAPL", "side": "sell", "quantity": 999}, headers=trader)
    assert r.status_code == 400

    r = client.post("/trading/orders", json={"symbol": "AAPL", "side": "sell", "quantity": 10}, headers=trader)
    assert r.status_code == 200
    assert r.json()["data"]["order"]["realized_pnl"] is not None

    r = client.post("/trading/position-size", json={"entry": 100, "stop": 95, "risk_pct": 1, "equity": 10000}, headers=trader)
    assert r.status_code == 200
    plan = r.json()["data"]
    assert plan["valid"] is True and plan["shares"] == 20 and plan["direction"] == "long"

    r = client.get("/trading/analyze/AAPL?timeframe=1d", headers=trader)
    assert r.status_code == 200
    analysis = r.json()["data"]
    assert analysis["bias"] in {"bullish", "bearish", "neutral"}
    assert "indicators" in analysis and "disclaimer" in analysis

    r = client.post("/trading/screen", json={"query": "uptrend momentum", "symbols": ["AAPL", "MSFT", "NVDA"]}, headers=trader)
    assert r.status_code == 200 and "results" in r.json()["data"]

    r = client.post("/trading/journal", json={
        "symbol": "AAPL", "side": "buy", "entry_price": 100, "exit_price": 110,
        "stop_price": 95, "quantity": 10, "thesis": "breakout", "emotion": "calm"}, headers=trader)
    assert r.status_code == 200
    entry_id = r.json()["data"]["id"]
    assert r.json()["data"]["pnl"] == 100.0

    r = client.post(f"/trading/journal/{entry_id}/review", headers=trader)
    assert r.status_code == 200 and r.json()["data"]["feedback"]

    r = client.get("/trading/academy", headers=trader)
    assert r.status_code == 200 and len(r.json()["data"]["modules"]) >= 3


def test_quote_matches_latest_candle(client):
    """The synthetic series is one canonical walk: the quote's price must equal
    the last candle's close regardless of how many bars were requested."""
    trader = _auth(client, "consistent@example.com")
    q = client.get("/trading/quote/TSLA", headers=trader).json()["data"]
    for limit in (60, 200):
        candles = client.get(f"/trading/candles/TSLA?timeframe=1d&limit={limit}", headers=trader).json()["data"]["candles"]
        assert candles[-1]["c"] == q["price"], f"quote {q['price']} != last close at limit={limit}"


def test_only_real_symbols(client):
    """Synthetic mode must reject fabricated tickers and accept real ones."""
    trader = _auth(client, "real@example.com")

    # A real ticker resolves, with the company name attached.
    q = client.get("/trading/quote/AAPL", headers=trader)
    assert q.status_code == 200
    assert q.json()["data"]["name"] == "Apple Inc."

    # A fabricated ticker is rejected everywhere it could produce a chart.
    for path, method, body in [
        ("/trading/quote/FAKE123", "get", None),
        ("/trading/candles/FAKE123", "get", None),
        ("/trading/analyze/FAKE123", "get", None),
        ("/trading/orders", "post", {"symbol": "FAKE123", "side": "buy", "quantity": 1}),
        ("/trading/watchlist", "post", {"symbol": "FAKE123"}),
    ]:
        r = client.get(path, headers=trader) if method == "get" else client.post(path, json=body, headers=trader)
        assert r.status_code == 404, f"{path} should reject a fake symbol"
        assert r.json()["meta"]["code"] == "unknown_symbol"

    # Symbol search returns real matches (ticker + name).
    s = client.get("/trading/symbols?q=app", headers=trader)
    assert s.status_code == 200
    results = s.json()["data"]["symbols"]
    assert any(x["symbol"] == "AAPL" and "Apple" in x["name"] for x in results)


def test_crypto_symbol_with_slash(client):
    """Slash-bearing symbols (crypto pairs) must route via {symbol:path}."""
    trader = _auth(client, "crypto@example.com")
    q = client.get("/trading/quote/BTC/USD", headers=trader)
    assert q.status_code == 200
    assert q.json()["data"]["symbol"] == "BTC/USD"
    assert q.json()["data"]["name"] == "Bitcoin"
    c = client.get("/trading/candles/BTC/USD?timeframe=1d&limit=10", headers=trader)
    assert c.status_code == 200 and len(c.json()["data"]["candles"]) == 10


def test_watchlist(client):
    trader = _auth(client, "watch@example.com")
    assert client.post("/trading/watchlist", json={"symbol": "nvda"}, headers=trader).status_code == 200
    r = client.get("/trading/watchlist", headers=trader)
    assert "NVDA" in r.json()["data"]["symbols"]
    assert client.delete("/trading/watchlist/NVDA", headers=trader).status_code == 200
