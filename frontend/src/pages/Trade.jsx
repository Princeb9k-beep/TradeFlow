// Trade cockpit — chart-first workspace over the paper account.
//
// Dependency-free inline-SVG candlestick chart (SMA overlays + AI support/
// resistance), paper order ticket, positions with live P&L, AI read, natural-
// language screener, risk-first position sizer, journal with AI review, and the
// Academy. Colors resolve from CSS variables so the chart re-themes with the app.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import ProChart from "./ProChart.jsx";

const TIMEFRAMES = ["15m", "1h", "1d"];
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
        {[["chart", "Chart & Trade"], ["screen", "Screener"], ["journal", "Journal"], ["learn", "Academy"]].map(([k, label]) => (
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
                <ProChart candles={candles} levels={analysis?.levels} symbol={symbol} themeTick={themeTick} />
              )}

              <div className="card" style={{ marginTop: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>AI Read</h3>
                  <button className="btn" onClick={runAnalyze} disabled={analyzing}>{analyzing ? "Analyzing…" : "Analyze chart"}</button>
                </div>
                {analysis && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                      <span className={`bias ${analysis.bias}`}>{analysis.bias}</span>
                      <span className="muted mono" style={{ fontSize: 13 }}>RSI {analysis.indicators?.rsi14 ?? "—"} · trend {analysis.indicators?.trend ?? "—"}</span>
                    </div>
                    <p>{analysis.summary}</p>
                    <div className="stat-grid">
                      <Stat label="Support" value={money(analysis.levels?.support)} tone="up" />
                      <Stat label="Resistance" value={money(analysis.levels?.resistance)} tone="down" />
                      <Stat label="SMA20" value={money(analysis.indicators?.sma20)} />
                      <Stat label="SMA50" value={money(analysis.indicators?.sma50)} />
                      <Stat label="ATR14" value={analysis.indicators?.atr14 ?? "—"} />
                    </div>
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
      {tab === "learn" && <Academy />}
    </section>
  );
}

function OrderTicket({ symbol, price, account, onFilled, notify }) {
  const [qty, setQty] = useState(10);
  const [busy, setBusy] = useState(false);
  const cost = price ? price * (Number(qty) || 0) : null;
  const locked = account?.locked;
  async function submit(side) {
    if (!qty || qty <= 0) return;
    setBusy(true);
    try {
      const res = await api.tradeOrder(symbol, side, Number(qty));
      onFilled(res.account);
      notify(`${side === "buy" ? "Bought" : "Sold"} ${qty} ${symbol} @ ${money(res.order.price)}`);
    } catch (err) { notify(err.message); } finally { setBusy(false); }
  }
  return (
    <div className="card">
      <h3>Order ticket</h3>
      <div className="muted mono" style={{ fontSize: 13, marginBottom: 8 }}>{symbol} @ {money(price)}</div>
      <label>Quantity<input className="mono" type="number" min="0" step="1" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
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
