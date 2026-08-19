"""
Application configuration.

Typed settings loaded from environment variables (and a local `.env` in
development) via pydantic-settings. One validated source of truth so the rest of
the app never reaches for os.getenv.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- PostgreSQL -------------------------------------------------------
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "tradeflow"
    postgres_user: str = "postgres"
    postgres_password: str = ""
    # A full URL (e.g. a hosted connection string) takes precedence when set.
    database_url: str = ""

    # --- Redis (optional; app degrades gracefully without it) -------------
    redis_url: str = "redis://localhost:6379"
    redis_password: str = ""

    # --- Groq AI (optional; features fall back without a key) -------------
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # --- App --------------------------------------------------------------
    app_env: str = "development"
    app_secret_key: str = "change-me"
    app_debug: bool = False
    cors_origins: str = "*"
    ai_cache_ttl_seconds: int = 60 * 60 * 24

    # --- Market data ------------------------------------------------------
    # Provider for quotes & candles:
    #   "yahoo"     — real market data, no API key (default). Degrades to
    #                 synthetic automatically if unreachable.
    #   "synthetic" — deterministic per-symbol series; no key/network, so the
    #                 app and tests run fully offline.
    #   "alpaca"    — real bars via an Alpaca account (set the keys below); also
    #                 the path toward live order routing.
    market_data_provider: str = "yahoo"
    alpaca_api_key: str = ""
    alpaca_api_secret: str = ""
    alpaca_data_url: str = "https://data.alpaca.markets"
    alpaca_trading_url: str = "https://paper-api.alpaca.markets"

    # --- Trading ----------------------------------------------------------
    # Master switch for real-broker order routing. OFF by default: every order
    # settles against the in-app paper account until this is on AND a broker is
    # connected. Real money stays behind this gate + disclaimers.
    live_trading_enabled: bool = False
    paper_starting_cash: float = 100_000.0
    # Simulated execution realism: slippage (basis points, worse for the taker)
    # and a flat commission per fill (0 = commission-free, like most US brokers).
    slippage_bps: float = 1.0
    commission_per_order: float = 0.0

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    @property
    def async_database_url(self) -> str:
        """A SQLAlchemy async URL, normalizing common hosted formats."""
        if self.database_url:
            url = self.database_url
            if url.startswith("postgres://"):
                url = url.replace("postgres://", "postgresql+asyncpg://", 1)
            elif url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
            return url
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
