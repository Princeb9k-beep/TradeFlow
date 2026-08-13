"""
Symbol catalog — real, listed instruments only.

Tradeflow trades actual tickers, not arbitrary strings. This module is the
source of truth for which symbols are real (company name, exchange, sector), and
it powers search/autocomplete and input validation. In synthetic-data mode the
router rejects anything not listed here, so a fabricated ticker can never produce
a chart. When a real market-data provider (Alpaca) is enabled, validation relaxes
because the provider itself is the authority on what's tradable.

The list is a curated set of widely-traded US equities, major ETFs, and the
largest crypto pairs — enough for a realistic product without shipping the whole
exchange. Extend `_CATALOG` to add more.
"""

from __future__ import annotations

# (symbol, company name, exchange, sector)
_CATALOG: list[tuple[str, str, str, str]] = [
    # --- Mega-cap tech & communication ---
    ("AAPL", "Apple Inc.", "NASDAQ", "Technology"),
    ("MSFT", "Microsoft Corporation", "NASDAQ", "Technology"),
    ("NVDA", "NVIDIA Corporation", "NASDAQ", "Technology"),
    ("AMZN", "Amazon.com, Inc.", "NASDAQ", "Consumer Discretionary"),
    ("GOOGL", "Alphabet Inc. (Class A)", "NASDAQ", "Communication Services"),
    ("GOOG", "Alphabet Inc. (Class C)", "NASDAQ", "Communication Services"),
    ("META", "Meta Platforms, Inc.", "NASDAQ", "Communication Services"),
    ("TSLA", "Tesla, Inc.", "NASDAQ", "Consumer Discretionary"),
    ("AVGO", "Broadcom Inc.", "NASDAQ", "Technology"),
    ("ORCL", "Oracle Corporation", "NYSE", "Technology"),
    ("CRM", "Salesforce, Inc.", "NYSE", "Technology"),
    ("ADBE", "Adobe Inc.", "NASDAQ", "Technology"),
    ("AMD", "Advanced Micro Devices, Inc.", "NASDAQ", "Technology"),
    ("INTC", "Intel Corporation", "NASDAQ", "Technology"),
    ("QCOM", "QUALCOMM Incorporated", "NASDAQ", "Technology"),
    ("CSCO", "Cisco Systems, Inc.", "NASDAQ", "Technology"),
    ("IBM", "International Business Machines Corporation", "NYSE", "Technology"),
    ("TXN", "Texas Instruments Incorporated", "NASDAQ", "Technology"),
    ("MU", "Micron Technology, Inc.", "NASDAQ", "Technology"),
    ("NFLX", "Netflix, Inc.", "NASDAQ", "Communication Services"),
    ("PYPL", "PayPal Holdings, Inc.", "NASDAQ", "Financials"),
    ("SHOP", "Shopify Inc.", "NYSE", "Technology"),
    ("UBER", "Uber Technologies, Inc.", "NYSE", "Technology"),
    ("PLTR", "Palantir Technologies Inc.", "NASDAQ", "Technology"),
    ("SNOW", "Snowflake Inc.", "NYSE", "Technology"),
    # --- Financials ---
    ("JPM", "JPMorgan Chase & Co.", "NYSE", "Financials"),
    ("BAC", "Bank of America Corporation", "NYSE", "Financials"),
    ("WFC", "Wells Fargo & Company", "NYSE", "Financials"),
    ("GS", "The Goldman Sachs Group, Inc.", "NYSE", "Financials"),
    ("MS", "Morgan Stanley", "NYSE", "Financials"),
    ("C", "Citigroup Inc.", "NYSE", "Financials"),
    ("V", "Visa Inc.", "NYSE", "Financials"),
    ("MA", "Mastercard Incorporated", "NYSE", "Financials"),
    ("AXP", "American Express Company", "NYSE", "Financials"),
    # --- Healthcare ---
    ("UNH", "UnitedHealth Group Incorporated", "NYSE", "Healthcare"),
    ("JNJ", "Johnson & Johnson", "NYSE", "Healthcare"),
    ("LLY", "Eli Lilly and Company", "NYSE", "Healthcare"),
    ("PFE", "Pfizer Inc.", "NYSE", "Healthcare"),
    ("MRK", "Merck & Co., Inc.", "NYSE", "Healthcare"),
    ("ABBV", "AbbVie Inc.", "NYSE", "Healthcare"),
    ("TMO", "Thermo Fisher Scientific Inc.", "NYSE", "Healthcare"),
    ("ABT", "Abbott Laboratories", "NYSE", "Healthcare"),
    # --- Consumer ---
    ("WMT", "Walmart Inc.", "NYSE", "Consumer Staples"),
    ("COST", "Costco Wholesale Corporation", "NASDAQ", "Consumer Staples"),
    ("PG", "The Procter & Gamble Company", "NYSE", "Consumer Staples"),
    ("KO", "The Coca-Cola Company", "NYSE", "Consumer Staples"),
    ("PEP", "PepsiCo, Inc.", "NASDAQ", "Consumer Staples"),
    ("MCD", "McDonald's Corporation", "NYSE", "Consumer Discretionary"),
    ("NKE", "NIKE, Inc.", "NYSE", "Consumer Discretionary"),
    ("SBUX", "Starbucks Corporation", "NASDAQ", "Consumer Discretionary"),
    ("HD", "The Home Depot, Inc.", "NYSE", "Consumer Discretionary"),
    ("DIS", "The Walt Disney Company", "NYSE", "Communication Services"),
    ("TGT", "Target Corporation", "NYSE", "Consumer Discretionary"),
    # --- Industrials, energy, autos, telecom ---
    ("BA", "The Boeing Company", "NYSE", "Industrials"),
    ("CAT", "Caterpillar Inc.", "NYSE", "Industrials"),
    ("GE", "GE Aerospace", "NYSE", "Industrials"),
    ("XOM", "Exxon Mobil Corporation", "NYSE", "Energy"),
    ("CVX", "Chevron Corporation", "NYSE", "Energy"),
    ("F", "Ford Motor Company", "NYSE", "Consumer Discretionary"),
    ("GM", "General Motors Company", "NYSE", "Consumer Discretionary"),
    ("T", "AT&T Inc.", "NYSE", "Communication Services"),
    ("VZ", "Verizon Communications Inc.", "NYSE", "Communication Services"),
    # --- ETFs ---
    ("SPY", "SPDR S&P 500 ETF Trust", "NYSE Arca", "ETF"),
    ("QQQ", "Invesco QQQ Trust", "NASDAQ", "ETF"),
    ("DIA", "SPDR Dow Jones Industrial Average ETF Trust", "NYSE Arca", "ETF"),
    ("IWM", "iShares Russell 2000 ETF", "NYSE Arca", "ETF"),
    ("VTI", "Vanguard Total Stock Market ETF", "NYSE Arca", "ETF"),
    ("VOO", "Vanguard S&P 500 ETF", "NYSE Arca", "ETF"),
    ("ARKK", "ARK Innovation ETF", "NYSE Arca", "ETF"),
    ("GLD", "SPDR Gold Shares", "NYSE Arca", "ETF"),
    # --- Crypto (Alpaca-style pairs) ---
    ("BTC/USD", "Bitcoin", "Crypto", "Crypto"),
    ("ETH/USD", "Ethereum", "Crypto", "Crypto"),
    ("SOL/USD", "Solana", "Crypto", "Crypto"),
    ("DOGE/USD", "Dogecoin", "Crypto", "Crypto"),
    ("XRP/USD", "XRP", "Crypto", "Crypto"),
    ("LTC/USD", "Litecoin", "Crypto", "Crypto"),
]

# Fast lookups.
_BY_SYMBOL: dict[str, dict] = {
    sym: {"symbol": sym, "name": name, "exchange": exch, "sector": sect}
    for (sym, name, exch, sect) in _CATALOG
}


def normalize(symbol: str) -> str:
    return symbol.strip().upper()


def is_known(symbol: str) -> bool:
    return normalize(symbol) in _BY_SYMBOL


def info(symbol: str) -> dict | None:
    return _BY_SYMBOL.get(normalize(symbol))


def name_for(symbol: str) -> str:
    entry = _BY_SYMBOL.get(normalize(symbol))
    return entry["name"] if entry else normalize(symbol)


def all_symbols() -> list[dict]:
    return list(_BY_SYMBOL.values())


def search(query: str, limit: int = 20) -> list[dict]:
    """Match a query against ticker or company name; ticker matches rank first."""
    q = query.strip().upper()
    if not q:
        return all_symbols()[:limit]
    starts, contains = [], []
    for entry in _BY_SYMBOL.values():
        sym, name = entry["symbol"], entry["name"].upper()
        if sym.startswith(q):
            starts.append(entry)
        elif q in sym or q in name:
            contains.append(entry)
    return (starts + contains)[:limit]


def default_universe(n: int = 16) -> list[str]:
    """A sensible starter watchlist / screener universe (real tickers)."""
    return [
        "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD",
        "JPM", "V", "WMT", "XOM", "SPY", "QQQ", "BTC/USD", "ETH/USD",
    ][:n]
