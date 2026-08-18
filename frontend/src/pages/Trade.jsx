// Trade cockpit — chart-first workspace over the paper account.
//
// Dependency-free inline-SVG candlestick chart (SMA overlays + AI support/
// resistance), paper order ticket, positions with live P&L, AI read, natural-
// language screener, risk-first position sizer, journal with AI review, and the
// Academy. Colors resolve from CSS variables so the chart re-themes with the app.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import ProChart from "./ProChart.jsx";

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"];
const MARKET_LABEL = {
  REGULAR: "Live", PRE: "Pre-market", PREPRE: "Pre-market",
  POST: "After hours", POSTPOST: "After hours", CLOSED: "Market closed",
  SIMULATED: "Simulated", DELAYED: "Delayed", UNKNOWN: "",
};
const marketLabel = (s) => MARKET_LABEL[s] ?? (s ? s.toLowerCase() : "");
const money = (n) => (n == null || isNaN(n) ? "—" : n.toLocaleString(undefined, { style: "currency", currency: "USD" }));
const pct = (n) => (n == null || isNaN(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);

function LoadingState({ label = "Loading…" }) { return <div className="state" role="status">{label}</div>; }
function ErrorBanner({ message, onRetry }) {
  return <div className="state state-error" role="alert"><p>{message}</p>{onRetry && <button className="btn ghost" onClick={onRetry}>Try again</button>}</div>;
}

function Stat({ label, value, tone }) {
  const color = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--text)";
  return <div className="stat"><div className="k">{label}</div><div className="v mono" style={{ color }}>{value}</div></div>;
}

export default function Trade({ notify }) {
  const [symbol, setSymbol] = useState("AAPL");
  const [symbolInput, setSymbolInput] = useState("AAPL");
  const [timeframe, setTimeframe] = useState("1d");
  const [candles, setCandles] = useState(null);
  const [quote, setQuote] = useState(null);
  const [account, setAccount] = useState(null);
  const [watch, setWatch] = useState({ symbols: [], quotes: [] });
  const [analysis, setAnalysis] = useState(null);
  const [tab, setTab] = useState("chart");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [themeTick, setThemeTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const [catalog, setCatalog] = useState([]);
  const nameMap = useMemo(() => Object.fromEntries(catalog.map((c) => [c.symbol, c.name])), [catalog]);

  useEffect(() => {
    const h = () => setThemeTick((t) => t + 1);
    window.addEventListener("theme:changed", h);
    return () => window.removeEventListener("theme:changed", h);
  }, []);

  useEffect(() => {
    api.tradeSymbols("", 100).then((d) => setCatalog(d.symbols)).catch(() => {});
  }, []);

  const loadChart = useCallback(async (sym, tf) => {
    setLoading(true); setError(null); setAnalysis(null);
    try {
      const [c, q] = await Promise.all([api.tradeCandles(sym, tf, 120), api.tradeQuote(sym)]);
      setCandles(c.candles); setQuote(q); setLastUpdated(Date.now());
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);

  const loadAccount = useCallback(async () => {
    try { setAccount(await api.tradeAccount()); } catch (err) { notify(err.message); }
  }, [notify]);
  const loadWatch = useCallback(async () => {
    try { setWatch(await api.tradeWatchlist()); } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadChart(symbol, timeframe); }, [symbol, timeframe, loadChart]);
  useEffect(() => { loadAccount(); loadWatch(); }, [loadAccount, loadWatch]);

  // Silent refresh — updates chart, quote, positions, and watchlist in place
  // (no loading spinner) so prices tick over on their own.
  const refresh = useCallback(async () => {
    try {
      const [c, q] = await Promise.all([api.tradeCandles(symbol, timeframe, 120), api.tradeQuote(symbol)]);
      setCandles(c.candles); setQuote(q); setLastUpdated(Date.now());
    } catch { /* keep the last good data */ }
    loadAccount(); loadWatch();
  }, [symbol, timeframe, loadAccount, loadWatch]);

  // Poll every 15s while the tab is visible (real-time updates).
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) refresh();
    }, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  // 1s heartbeat so the "updated Ns ago" label stays honest.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function pickSymbol(sym) {
    const s = (sym || "").trim().toUpperCase();
    if (!s) return;
    setSymbol(s); setSymbolInput(s); setTab("chart");
  }

  async function runAnalyze() {
    setAnalyzing(true);
    try { setAnalysis(await api.tradeAnalyze(symbol, timeframe)); }
    catch (err) { notify(err.message); }
    finally { setAnalyzing(false); }
  }

  return (
    <section>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline", justifyContent: "space-between" }}>
        <h1 style={{ marginBottom: 0 }}>Trade Desk</h1>
        {account && (
          <div className="equity-mini">
            <div><span className="lbl">Cash</span> <span className="val mono">{money(account.cash)}</span></div>
            <div><span className="lbl">Equity</span> <span className="val mono">{money(account.equity)}</span></div>
            <div><span className="lbl">Mode</span> <span className="val">{account.live_trading_enabled ? "Live-ready" : "Paper"}</span></div>
          </div>
        )}
      </div>

      <div className="tabs">
        {[["chart", "Chart & Trade"], ["screen", "Screener"], ["challenge", "Challenge"], ["journal", "Journal"], ["perf", "Performance"], ["learn", "Academy"]].map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {/* Autocomplete of real, listed tickers — shared by every symbol input. */}
      <datalist id="symbol-list">
        {catalog.map((c) => (<option key={c.symbol} value={c.symbol}>{c.name}</option>))}
      </datalist>

      {tab === "chart" && (
        <>
          <form className="controls" onSubmit={(e) => { e.preventDefault(); pickSymbol(symbolInput); }}>
            <input value={symbolInput} onChange={(e) => setSymbolInput(e.target.value.toUpperCase())} placeholder="Symbol (AAPL, BTC/USD…)" aria-label="Symbol" spellCheck="false" list="symbol-list" />
            <button className="btn" type="submit">Load</button>
            <div className="tf-group">
              {TIMEFRAMES.map((tf) => (
                <button key={tf} type="button" className={`tf ${tf === timeframe ? "active" : ""}`} onClick={() => setTimeframe(tf)}>{tf}</button>
              ))}
            </div>
          </form>

          <div className="cockpit">
            <div>
              {quote && (
                <div className="quote">
                  <span className="tick mono">{quote.symbol}</span>
                  <span className={`price mono ${quote.change >= 0 ? "up" : "down"}`}>{money(quote.price)}</span>
                  <span className={quote.change >= 0 ? "up" : "down"} style={{ fontWeight: 700 }}>{quote.change >= 0 ? "▲" : "▼"} {pct(quote.change_pct)}</span>
                  <span className="live-badge" style={{ marginLeft: "auto" }}>
                    <span className={`live-dot ${quote.market_state === "REGULAR" ? "on" : ""}`} />
                    {marketLabel(quote.market_state)}
                    {lastUpdated ? ` · updated ${Math.max(0, Math.round((nowTick - lastUpdated) / 1000))}s ago` : ""}
                  </span>
                  {quote.name && <span className="muted" style={{ flexBasis: "100%", fontSize: 13 }}>{quote.name}</span>}
                </div>
              )}
              {error && <ErrorBanner message={error} onRetry={() => loadChart(symbol, timeframe)} />}
              {loading ? <LoadingState label="Loading chart…" /> : (
                <ProChart candles={candles} levels={analysis?.levels} symbol={symbol} timeframe={timeframe} themeTick={themeTick} />
              )}

              <div className="card" style={{ marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>AI Read</h3>
                  <button className="btn" onClick={runAnalyze} disabled={analyzing}>{analyzing ? "Analyzing…" : "Analyze chart"}</button>
                </div>
                {analysis && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                      <span className={`bias ${analysis.bias}`}>{analysis.bias}</span>
                      {analysis.confidence != null && (
                        <span className="conf"><span className="conf-bar"><span className="conf-fill" style={{ width: `${analysis.confidence}%` }} /></span>{analysis.confidence}% confidence</span>
                      )}
                      {analysis.structure && (
                        <span className="muted mono" style={{ fontSize: 13 }}>
                          {analysis.structure.structure}{analysis.structure.labels?.length ? ` · ${analysis.structure.labels.join("/")}` : ""} · {analysis.structure.event}
                        </span>
                      )}
                    </div>
                    <p>{analysis.summary}</p>
                    {analysis.plan && analysis.plan.entry != null && (
                      <div className="plan-row">
                        <div className="plan-cell"><span className="k">Entry</span><b className="mono">{money(analysis.plan.entry)}</b></div>
                        <div className="plan-cell down"><span className="k">Stop</span><b className="mono">{money(analysis.plan.stop)}</b></div>
                        <div className="plan-cell up"><span className="k">Target</span><b className="mono">{money(analysis.plan.target)}</b></div>
                        <div className="plan-cell"><span className="k">R:R</span><b className="mono">{analysis.plan.reward_risk ?? "—"}</b></div>
                        <div className="plan-cell"><span className="k">Setup</span><b>{analysis.plan.setup}</b></div>
                      </div>
                    )}
                    <div className="stat-grid">
                      <Stat label="Support" value={money(analysis.levels?.support)} tone="up" />
                      <Stat label="Resistance" value={money(analysis.levels?.resistance)} tone="down" />
                      {analysis.session?.prev_high != null && <Stat label="Prev H" value={money(analysis.session.prev_high)} />}
                      {analysis.session?.prev_low != null && <Stat label="Prev L" value={money(analysis.session.prev_low)} />}
                      {analysis.session?.gap_pct != null && <Stat label="Gap" value={pct(analysis.session.gap_pct)} tone={analysis.session.gap_pct >= 0 ? "up" : "down"} />}
                      <Stat label="ATR14" value={analysis.indicators?.atr14 ?? "—"} />
                    </div>
                    {analysis.verify?.length > 0 && (
                      <div className="verify">
                        <div className="k" style={{ fontSize: 11, textTransform: "uppercase", color: "var(--muted)" }}>Verify it yourself</div>
                        <ul>{analysis.verify.map((v, i) => <li key={i}>{v}</li>)}</ul>
                      </div>
                    )}
                    <p className="fine">{analysis.disclaimer}</p>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <OrderTicket symbol={symbol} price={quote?.price} account={account} onFilled={setAccount} notify={notify} />
              <Positions account={account} onPick={pickSymbol} onSold={loadAccount} notify={notify} />
              <PositionSizer defaultEquity={account?.equity} price={quote?.price} />
              <Watchlist watch={watch} current={symbol} onPick={pickSymbol} reload={loadWatch} notify={notify} nameMap={nameMap} />
            </div>
          </div>
        </>
      )}

      {tab === "screen" && <Screener universe={watch.symbols} onPick={pickSymbol} notify={notify} nameMap={nameMap} />}
      {tab === "journal" && <Journal notify={notify} defaultSymbol={symbol} />}
      {tab === "challenge" && <MarketChallenge notify={notify} themeTick={themeTick} />}
      {tab === "perf" && <Performance notify={notify} />}
      {tab === "learn" && <Academy />}
    </section>
  );
}

function MarketChallenge({ notify, themeTick }) {
  const [game, setGame] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sess, setSess] = useState({ played: 0, correct: 0, score: 0, streak: 0, best: 0 });

  const newGame = useCallback(async () => {
    setBusy(true); setResult(null);
    try { setGame(await api.challengeNew()); }
    catch (err) { notify(err.message); } finally { setBusy(false); }
  }, [notify]);
  useEffect(() => { newGame(); }, [newGame]);

  async function answer(choice) {
    if (!game || busy) return;
    setBusy(true);
    try {
      const r = await api.challengeAnswer(game.token, choice);
      setResult(r);
      setSess((s) => ({
        played: s.played + 1,
        correct: s.correct + (r.correct ? 1 : 0),
        score: s.score + r.score,
        streak: r.correct ? s.streak + 1 : 0,
        best: Math.max(s.best, r.correct ? s.streak + 1 : 0),
      }));
    } catch (err) { notify(err.message); } finally { setBusy(false); }
  }

  const candles = game ? (result ? game.setup.concat(result.future) : game.setup) : [];
  const chartKey = game ? `chal-${game.token.slice(-12)}` : "chal";
  const avg = sess.played ? Math.round(sess.score / sess.played) : 0;

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Market Challenge</h3>
          <div className="chal-stats mono">
            <span>Played <b>{sess.played}</b></span>
            <span>Correct <b>{sess.played ? Math.round(sess.correct / sess.played * 100) : 0}%</b></span>
            <span>Avg score <b>{avg}</b></span>
            <span>Streak <b className="up">{sess.streak}🔥</b></span>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 14, marginBottom: 0 }}>
          Read the chart — the next {game?.horizon ?? 10} candles are hidden. Would you <b>buy</b>, <b>sell</b>, or <b>wait</b>? The blue line is your entry.
        </p>
      </div>

      <div className="chart-shell" style={{ marginBottom: 12 }}>
        {candles.length ? (
          <ProChart candles={candles} symbol={chartKey} timeframe={game?.timeframe} entryLine={game?.entry} themeTick={themeTick} />
        ) : <LoadingState label="Dealing a chart…" />}
      </div>

      {!result ? (
        <div className="chal-actions">
          <button className="chal-btn buy" disabled={busy} onClick={() => answer("buy")}>▲ BUY</button>
          <button className="chal-btn wait" disabled={busy} onClick={() => answer("wait")}>⏸ WAIT</button>
          <button className="chal-btn sell" disabled={busy} onClick={() => answer("sell")}>▼ SELL</button>
        </div>
      ) : (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span className={`tier-badge tier-${result.tier.toLowerCase()}`}>{result.tier}</span>
            <span style={{ fontSize: 22, fontWeight: 750 }}>{result.score}<span className="muted" style={{ fontSize: 14 }}>/100</span></span>
            <span className={result.correct ? "up" : "down"} style={{ fontWeight: 700 }}>{result.correct ? "✓ Correct" : "✗ Off this time"}</span>
            <span className="muted mono" style={{ marginLeft: "auto" }}>{result.name} ({result.symbol})</span>
          </div>
          <div className="stat-grid" style={{ marginTop: 10 }}>
            <Stat label="Move" value={pct(result.move_pct)} tone={result.move_pct >= 0 ? "up" : "down"} />
            <Stat label="Best case" value={pct(result.mfe_pct)} tone="up" />
            <Stat label="Worst case" value={pct(result.mae_pct)} tone="down" />
            <Stat label="Entry" value={money(result.entry)} />
            <Stat label="Close" value={money(result.final)} />
          </div>
          <p style={{ marginTop: 8 }}>{result.explanation}</p>
          <button className="btn" onClick={newGame} disabled={busy}>Next challenge →</button>
        </div>
      )}
    </div>
  );
}

function Performance({ notify }) {
  const [stats, setStats] = useState(null);
  const [risk, setRisk] = useState(null);
  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([api.tradeStats(), api.tradeRiskCheck()]);
      setStats(s); setRisk(r);
    } catch (err) { notify(err.message); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  if (!stats) return <LoadingState />;

  const cards = [
    { k: "Trades", v: stats.trades },
    { k: "Win rate", v: `${stats.win_rate}%` },
    { k: "Net P&L", v: money(stats.total_pnl), tone: stats.total_pnl >= 0 ? "up" : "down" },
    { k: "Profit factor", v: stats.profit_factor ?? "—" },
    { k: "Expectancy", v: money(stats.expectancy), tone: stats.expectancy >= 0 ? "up" : "down" },
    { k: "Avg win", v: money(stats.avg_win), tone: "up" },
    { k: "Avg loss", v: money(stats.avg_loss), tone: "down" },
    { k: "Avg R:R", v: stats.avg_reward_risk ?? "—" },
  ];

  return (
    <div>
      <div className="card">
        <h3>AI Risk Monitor</h3>
        {!risk ? <LoadingState /> : risk.warnings.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>✓ No risk flags — your recent activity looks disciplined.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {risk.warnings.map((w, i) => (
              <div key={i} className={`risk-flag ${w.level}`}>
                <b>{w.type.replace(/_/g, " ")}</b> — {w.message}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Performance</h3>
        {stats.trades === 0 ? (
          <p className="muted">No closed trades yet. Take a few paper trades and your metrics will build here.</p>
        ) : (
          <>
            <div className="perf-grid">
              {cards.map((c) => (
                <div className="perf-cell" key={c.k}>
                  <div className="k">{c.k}</div>
                  <div className="v mono" style={{ color: c.tone === "up" ? "var(--up)" : c.tone === "down" ? "var(--down)" : "var(--text)" }}>{c.v}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
              {stats.best_symbol?.symbol && <Stat label="Best symbol" value={`${stats.best_symbol.symbol} ${money(stats.best_symbol.pnl)}`} tone="up" />}
              {stats.worst_symbol?.symbol && <Stat label="Worst symbol" value={`${stats.worst_symbol.symbol} ${money(stats.worst_symbol.pnl)}`} tone="down" />}
              <button className="btn ghost" style={{ width: "auto", alignSelf: "center" }} onClick={load}>Refresh</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OrderTicket({ symbol, price, account, onFilled, notify }) {
  const [qty, setQty] = useState(10);
  const [stop, setStop] = useState("");
  const [busy, setBusy] = useState(false);
  const cost = price ? price * (Number(qty) || 0) : null;
  const locked = account?.locked;
  const cash = account?.cash || 0;
  const equity = account?.equity || 0;
  const riskPct = account?.risk_per_trade_pct ?? 1;

  const perShare = price && stop ? Math.abs(price - Number(stop)) : 0;
  const riskAmt = perShare && qty ? perShare * Number(qty) : 0;

  const submit = useCallback(async (side) => {
    if (!qty || qty <= 0 || busy || locked) return;
    setBusy(true);
    try {
      const res = await api.tradeOrder(symbol, side, Number(qty));
      onFilled(res.account);
      notify(`${side === "buy" ? "Bought" : "Sold"} ${qty} ${symbol} @ ${money(res.order.price)}`);
    } catch (err) { notify(err.message); } finally { setBusy(false); }
  }, [qty, busy, locked, symbol, onFilled, notify]);

  // B / S hotkeys (ignored while typing in a field)
  useEffect(() => {
    const h = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "b" || e.key === "B") submit("buy");
      if (e.key === "s" || e.key === "S") submit("sell");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [submit]);

  function quick(frac) { if (price) setQty(Math.max(1, Math.floor((cash * frac) / price))); }
  function sizeFromRisk() {
    if (!price || !stop || perShare <= 0) { notify("Enter a stop to size from risk"); return; }
    const n = Math.floor((equity * (riskPct / 100)) / perShare);
    if (n < 1) { notify("Risk too small for one share at this stop"); return; }
    setQty(n);
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>Order ticket</h3>
        <span className="muted" style={{ fontSize: 11 }}>hotkeys B / S</span>
      </div>
      <div className="muted mono" style={{ fontSize: 13, margin: "8px 0" }}>{symbol} @ {money(price)}</div>
      <label>Quantity<input className="mono" type="number" min="0" step="1" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
      <div className="qty-quick">
        {[["25%", 0.25], ["50%", 0.5], ["100%", 1]].map(([l, f]) => (
          <button key={l} type="button" className="mini-btn" onClick={() => quick(f)}>{l}</button>
        ))}
      </div>
      <label style={{ marginTop: 8 }}>Stop (optional, for risk sizing)
        <input className="mono" type="number" step="0.01" value={stop} onChange={(e) => setStop(e.target.value)} placeholder="e.g. below support" />
      </label>
      <div className="qty-quick">
        <button type="button" className="mini-btn" onClick={sizeFromRisk}>Size {riskPct}% risk</button>
        {riskAmt > 0 && <span className="muted mono" style={{ fontSize: 12, alignSelf: "center" }}>risk {money(riskAmt)}</span>}
      </div>
      <div className="est"><span>Est. cost</span> <b className="mono">{money(cost)}</b></div>
      {locked && <p className="down" style={{ fontSize: 13 }}>Account locked — daily loss limit hit.</p>}
      <div className="bs">
        <button className="buy" disabled={busy || locked} onClick={() => submit("buy")}>Buy</button>
        <button className="sell" disabled={busy || locked} onClick={() => submit("sell")}>Sell</button>
      </div>
    </div>
  );
}

function Positions({ account, onPick, onSold, notify }) {
  const positions = account?.positions || [];
  async function sellAll(p) {
    try { await api.tradeOrder(p.symbol, "sell", p.quantity); notify(`Closed ${p.symbol}`); onSold(); }
    catch (err) { notify(err.message); }
  }
  return (
    <div className="card">
      <h3>Positions</h3>
      {positions.length === 0 ? <div className="empty">No open positions yet.</div> : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {positions.map((p) => (
            <div className="row" key={p.symbol}>
              <button className="chiplink" onClick={() => onPick(p.symbol)}><b className="mono">{p.symbol}</b> <span className="muted" style={{ fontSize: 12.5 }}>×{p.quantity}</span></button>
              <span className={`mono ${p.unrealized_pnl >= 0 ? "up" : "down"}`} style={{ fontWeight: 600, fontSize: 13 }}>{money(p.unrealized_pnl)} ({pct(p.unrealized_pct)})</span>
              <button className="close-btn" onClick={() => sellAll(p)}>Close</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PositionSizer({ defaultEquity, price }) {
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [risk, setRisk] = useState(1);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (price && entry === "") setEntry(String(price)); }, [price, entry]);
  async function compute(e) {
    e.preventDefault(); setBusy(true);
    try { setPlan(await api.tradePositionSize({ entry: Number(entry), stop: Number(stop), risk_pct: Number(risk), equity: defaultEquity || undefined })); }
    catch { setPlan(null); } finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h3>Position sizer</h3>
      <form onSubmit={compute} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label>Entry<input className="mono" type="number" step="0.01" value={entry} onChange={(e) => setEntry(e.target.value)} required /></label>
        <label>Stop<input className="mono" type="number" step="0.01" value={stop} onChange={(e) => setStop(e.target.value)} required /></label>
        <label>Risk %<input className="mono" type="number" step="0.1" value={risk} onChange={(e) => setRisk(e.target.value)} required /></label>
        <button className="btn" style={{ alignSelf: "end" }} disabled={busy}>Size it</button>
      </form>
      {plan && (plan.valid ? (
        <div style={{ marginTop: 10 }}>
          <div className="stat-grid" style={{ margin: 0 }}>
            <Stat label="Shares" value={plan.shares} />
            <Stat label="Risk $" value={money(plan.risk_amount)} tone="down" />
            <Stat label="Notional" value={money(plan.notional)} />
            <Stat label="% equity" value={`${plan.pct_of_equity}%`} />
          </div>
          <div className="fine">Targets: {plan.targets.map((t) => `${t.r}R ${money(t.price)}`).join(" · ")}</div>
        </div>
      ) : <p className="fine">{plan.reason}</p>)}
    </div>
  );
}

function Watchlist({ watch, current, onPick, reload, notify, nameMap = {} }) {
  const [add, setAdd] = useState("");
  async function addSym(e) {
    e.preventDefault();
    if (!add.trim()) return;
    try { await api.tradeAddWatch(add.trim().toUpperCase()); setAdd(""); reload(); }
    catch (err) { notify(err.message); }
  }
  async function remove(sym) {
    try { await api.tradeRemoveWatch(sym); reload(); } catch (err) { notify(err.message); }
  }
  const quoteFor = (sym) => watch.quotes?.find((q) => q.symbol === sym);
  return (
    <div className="card">
      <h3>Watchlist</h3>
      <form className="wl-add" onSubmit={addSym}>
        <input value={add} onChange={(e) => setAdd(e.target.value.toUpperCase())} placeholder="Add symbol" spellCheck="false" list="symbol-list" />
        <button className="btn ghost" type="submit" style={{ width: "auto" }}>+</button>
      </form>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {watch.symbols.map((sym) => {
          const q = quoteFor(sym);
          return (
            <div key={sym} className={`wl-row ${sym === current ? "active" : ""}`}>
              <button className="chiplink" style={{ flex: 1, overflow: "hidden" }} onClick={() => onPick(sym)}>
                <b className="mono">{sym}</b>
                {nameMap[sym] && <span className="muted" style={{ display: "block", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nameMap[sym]}</span>}
              </button>
              {q && <span className={`mono ${q.change >= 0 ? "up" : "down"}`} style={{ fontSize: 12.5 }}>{money(q.price)} {pct(q.change_pct)}</span>}
              <button className="x" aria-label={`Remove ${sym}`} onClick={() => remove(sym)}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Screener({ universe, onPick, notify, nameMap = {} }) {
  const [query, setQuery] = useState("oversold stocks in an uptrend");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  async function run(e) {
    e.preventDefault(); setBusy(true);
    try { setRes(await api.tradeScreen(query, universe || [])); } catch (err) { notify(err.message); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="card">
        <h3>Natural-language screener</h3>
        <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>Describe what you're looking for — e.g. "oversold names reclaiming the 200-day with momentum".</p>
        <form onSubmit={run} style={{ display: "flex", gap: 8 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
          <button className="btn" disabled={busy} style={{ width: "auto" }}>{busy ? "Scanning…" : "Scan"}</button>
        </form>
      </div>
      {res && (
        <div className="card">
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{res.count} match{res.count === 1 ? "" : "es"}</div>
          {res.results.length === 0 ? <p className="muted">Nothing matched. Try broadening the query.</p> : (
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Symbol</th><th>Company</th><th>Price</th><th>RSI</th><th>Trend</th><th>20d</th><th>Score</th></tr></thead>
                <tbody>
                  {res.results.map((r) => (
                    <tr key={r.symbol}>
                      <td><button className="chiplink" onClick={() => onPick(r.symbol)}><b className="mono">{r.symbol}</b></button></td>
                      <td className="muted" style={{ fontSize: 13 }}>{nameMap[r.symbol] || "—"}</td>
                      <td className="mono">{money(r.price)}</td>
                      <td className="mono">{r.rsi14 ?? "—"}</td>
                      <td className={r.trend === "up" ? "up" : r.trend === "down" ? "down" : ""}>{r.trend}</td>
                      <td className={`mono ${r.change_pct_20 >= 0 ? "up" : "down"}`}>{pct(r.change_pct_20)}</td>
                      <td className="mono">{r.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="fine">{res.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

function Journal({ notify, defaultSymbol }) {
  const [entries, setEntries] = useState(null);
  const [form, setForm] = useState({ symbol: defaultSymbol || "", side: "buy", entry_price: "", exit_price: "", stop_price: "", quantity: "", thesis: "", emotion: "" });
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(null);
  const load = useCallback(async () => {
    try { const d = await api.tradeJournal(); setEntries(d.entries); } catch (err) { notify(err.message); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  async function submit(e) {
    e.preventDefault(); setBusy(true);
    try {
      const num = (v) => (v === "" ? null : Number(v));
      await api.tradeAddJournal({
        symbol: form.symbol, side: form.side, entry_price: num(form.entry_price), exit_price: num(form.exit_price),
        stop_price: num(form.stop_price), quantity: num(form.quantity), thesis: form.thesis || null, emotion: form.emotion || null, tags: [],
      });
      setForm((f) => ({ ...f, thesis: "", emotion: "" }));
      notify("Trade logged"); load();
    } catch (err) { notify(err.message); } finally { setBusy(false); }
  }
  async function review(id) {
    setReviewing(id);
    try { const d = await api.tradeReviewJournal(id); setEntries((es) => es.map((e) => (e.id === id ? d.entry : e))); }
    catch (err) { notify(err.message); } finally { setReviewing(null); }
  }
  return (
    <div>
      <form className="card jform" onSubmit={submit}>
        <h3>Log a trade</h3>
        <div className="jgrid">
          <label>Symbol<input className="mono" value={form.symbol} onChange={(e) => set("symbol", e.target.value.toUpperCase())} required list="symbol-list" /></label>
          <label>Side<select value={form.side} onChange={(e) => set("side", e.target.value)}><option value="buy">Buy / Long</option><option value="sell">Sell / Short</option></select></label>
          <label>Entry<input className="mono" type="number" step="0.01" value={form.entry_price} onChange={(e) => set("entry_price", e.target.value)} /></label>
          <label>Exit<input className="mono" type="number" step="0.01" value={form.exit_price} onChange={(e) => set("exit_price", e.target.value)} /></label>
          <label>Stop<input className="mono" type="number" step="0.01" value={form.stop_price} onChange={(e) => set("stop_price", e.target.value)} /></label>
          <label>Qty<input className="mono" type="number" step="1" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} /></label>
          <label>Emotion<input value={form.emotion} onChange={(e) => set("emotion", e.target.value)} placeholder="calm, fomo…" /></label>
          <textarea rows={2} value={form.thesis} onChange={(e) => set("thesis", e.target.value)} placeholder="Thesis — why this trade?" />
        </div>
        <button className="btn" style={{ marginTop: 10, width: "auto" }} disabled={busy}>Log trade</button>
      </form>
      {entries == null ? <LoadingState /> : entries.length === 0 ? (
        <div className="card"><p className="muted">No trades logged yet. Your journal builds the record the AI coach reviews.</p></div>
      ) : entries.map((e) => (
        <div key={e.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div><b className="mono">{e.symbol}</b> <span className="muted">{e.side}</span>{e.pnl != null && <span className={`mono ${e.pnl >= 0 ? "up" : "down"}`} style={{ marginLeft: 8, fontWeight: 600 }}>{money(e.pnl)}</span>}</div>
            <button className="btn ghost" onClick={() => review(e.id)} disabled={reviewing === e.id} style={{ width: "auto" }}>{reviewing === e.id ? "Reviewing…" : e.ai_review ? "Re-review" : "AI review"}</button>
          </div>
          {e.thesis && <p style={{ margin: "6px 0", fontSize: 14 }}>{e.thesis}</p>}
          {e.ai_review && <div className="je"><div className="k" style={{ fontSize: 11, textTransform: "uppercase", color: "var(--muted)" }}>Coach</div><div className="coach">{e.ai_review}</div></div>}
        </div>
      ))}
    </div>
  );
}

function Academy() {
  const [modules, setModules] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { api.tradeAcademy().then((d) => setModules(d.modules)).catch(() => setModules([])); }, []);
  if (modules == null) return <LoadingState />;
  return (
    <div>
      <p className="muted">Learn by doing — each module pairs with the paper simulator on the Chart tab.</p>
      {modules.map((m) => (
        <div key={m.slug} className="acc-item">
          <button className="acc-head" onClick={() => setOpen(open === m.slug ? null : m.slug)}>
            <span><b>{m.title}</b> <span className="muted">· {m.level} · {m.minutes} min</span></span>
            <span>{open === m.slug ? "−" : "+"}</span>
          </button>
          {open === m.slug && (
            <div className="acc-body">
              <p className="muted" style={{ fontSize: 14 }}>{m.summary}</p>
              {m.lessons.map((l) => (<div className="lesson" key={l.key}><b>{l.title}</b><p>{l.body}</p></div>))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
