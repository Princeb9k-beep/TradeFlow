// ProChart — a professional, TradingView-style chart on lightweight-charts.
//
// Price pane (candles + volume) with overlay studies (SMA/EMA/VWAP/Bollinger),
// synced oscillator sub-panes (RSI, MACD), a full drawing toolkit (trendline,
// ray, horizontal & vertical lines, rectangle, Fib, measure) on a canvas overlay
// anchored to price/time, AI support/resistance as price lines, and Tradeflow
// branding in place of the library logo.

import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

const MAIN_H = 380;
const OSC_H = 130;
const toTime = (iso) => Math.floor(Date.parse(iso) / 1000);
const cssVar = (n, f) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f);

// --- studies -------------------------------------------------------------
const sma = (rows, p) => {
  const out = [];
  for (let i = p - 1; i < rows.length; i++) {
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += rows[j].close;
    out.push({ time: rows[i].time, value: +(s / p).toFixed(4) });
  }
  return out;
};
const emaArr = (vals, p) => {
  if (vals.length < p) return [];
  const k = 2 / (p + 1); let e = vals.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const out = Array(p - 1).fill(null); out.push(e);
  for (let i = p; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out.push(e); }
  return out;
};
const ema = (rows, p) => {
  const arr = emaArr(rows.map((r) => r.close), p);
  return rows.map((r, i) => (arr[i] == null ? null : { time: r.time, value: +arr[i].toFixed(4) })).filter(Boolean);
};
const bollinger = (rows, p = 20, m = 2) => {
  const upper = [], mid = [], lower = [];
  for (let i = p - 1; i < rows.length; i++) {
    const w = rows.slice(i - p + 1, i + 1).map((r) => r.close);
    const mean = w.reduce((a, b) => a + b, 0) / p;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / p);
    mid.push({ time: rows[i].time, value: +mean.toFixed(4) });
    upper.push({ time: rows[i].time, value: +(mean + m * sd).toFixed(4) });
    lower.push({ time: rows[i].time, value: +(mean - m * sd).toFixed(4) });
  }
  return { upper, mid, lower };
};
const vwap = (rows) => {
  let pv = 0, vv = 0; const out = [];
  for (const r of rows) { const tp = (r.high + r.low + r.close) / 3; pv += tp * r.volume; vv += r.volume; out.push({ time: r.time, value: +((vv ? pv / vv : r.close)).toFixed(4) }); }
  return out;
};
const rsiSeries = (rows, p = 14) => {
  const out = []; let g = 0, l = 0;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].close - rows[i - 1].close, up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; const rs = l === 0 ? 100 : g / l; out.push({ time: rows[i].time, value: +(l === 0 ? 100 : 100 - 100 / (1 + rs)).toFixed(2) }); } }
    else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; const rs = l === 0 ? 100 : g / l; out.push({ time: rows[i].time, value: +(l === 0 ? 100 : 100 - 100 / (1 + rs)).toFixed(2) }); }
  }
  return out;
};
const macdSeries = (rows) => {
  const closes = rows.map((r) => r.close);
  const e12 = emaArr(closes, 12), e26 = emaArr(closes, 26);
  const line = closes.map((_, i) => (e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null));
  const first = line.findIndex((v) => v != null);
  const sig = Array(closes.length).fill(null);
  if (first >= 0) {
    const seg = line.slice(first).map((v) => (v == null ? 0 : v)), k = 2 / 10;
    let e = seg.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    for (let i = 0; i < seg.length; i++) { if (i < 9) { if (i === 8) sig[first + i] = e; } else { e = seg[i] * k + e * (1 - k); sig[first + i] = e; } }
  }
  const macd = [], signal = [], hist = [];
  const up = cssVar("--up", "#26a69a"), down = cssVar("--down", "#ef5350");
  for (let i = 0; i < rows.length; i++) {
    if (line[i] != null) macd.push({ time: rows[i].time, value: +line[i].toFixed(4) });
    if (sig[i] != null) signal.push({ time: rows[i].time, value: +sig[i].toFixed(4) });
    if (line[i] != null && sig[i] != null) { const h = line[i] - sig[i]; hist.push({ time: rows[i].time, value: +h.toFixed(4), color: (h >= 0 ? up : down) + "88" }); }
  }
  return { macd, signal, hist };
};

const TOOLS = [
  { key: "cursor", label: "Cursor / pan", icon: "⤢" },
  { key: "trend", label: "Trend line", icon: "╱" },
  { key: "ray", label: "Ray", icon: "➚" },
  { key: "hline", label: "Horizontal line", icon: "─" },
  { key: "vline", label: "Vertical line", icon: "│" },
  { key: "rect", label: "Rectangle", icon: "▭" },
  { key: "fib", label: "Fib retracement", icon: "𝑓" },
  { key: "measure", label: "Measure", icon: "↔" },
];
const OVERLAYS = [
  { key: "sma20", label: "SMA 20", color: "#f5a623", make: (r) => sma(r, 20) },
  { key: "sma50", label: "SMA 50", color: "#3b82f6", make: (r) => sma(r, 50) },
  { key: "sma200", label: "SMA 200", color: "#a855f7", make: (r) => sma(r, 200) },
  { key: "ema9", label: "EMA 9", color: "#22d3ee", make: (r) => ema(r, 9) },
  { key: "ema21", label: "EMA 21", color: "#e879f9", make: (r) => ema(r, 21) },
  { key: "vwap", label: "VWAP", color: "#eab308", make: (r) => vwap(r) },
];
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export default function ProChart({ candles, levels, symbol, timeframe, themeTick }) {
  const wrapRef = useRef(null);
  const rsiHostRef = useRef(null);
  const macdHostRef = useRef(null);
  const overlayRef = useRef(null);

  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volRef = useRef(null);
  const ovRef = useRef({});           // overlay key -> series (or bb object)
  const oscRef = useRef({});          // 'rsi'|'macd' -> { chart, series... }
  const panesRef = useRef([]);        // [mainChart, ...oscCharts] for sync
  const priceLinesRef = useRef([]);
  const rowsRef = useRef([]);
  const syncing = useRef(false);
  const store = useRef({ drawings: [], pending: null });
  const toolRef = useRef("cursor");
  const firstFit = useRef(true);

  const [tool, setTool] = useState("cursor");
  const [ov, setOv] = useState({ sma20: true, sma50: true, sma200: false, ema9: false, ema21: false, vwap: false });
  const [bb, setBb] = useState(false);
  const [osc, setOsc] = useState({ rsi: false, macd: false });
  const [showVol, setShowVol] = useState(true);

  useEffect(() => { toolRef.current = tool; }, [tool]);

  const baseOpts = () => ({
    localization: { locale: "en-US" },
    layout: { background: { color: "transparent" }, textColor: cssVar("--muted", "#8b93a7"), fontFamily: "ui-sans-serif, system-ui, sans-serif", attributionLogo: false },
    grid: { vertLines: { color: cssVar("--grid", "rgba(255,255,255,.05)") }, horzLines: { color: cssVar("--grid", "rgba(255,255,255,.05)") } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: cssVar("--border", "#262c3a") },
    timeScale: { borderColor: cssVar("--border", "#262c3a"), timeVisible: true, secondsVisible: false },
  });

  const syncFrom = (source) => {
    if (syncing.current) return;
    const r = source.timeScale().getVisibleLogicalRange();
    if (!r) return;
    syncing.current = true;
    panesRef.current.forEach((c) => { if (c && c !== source) try { c.timeScale().setVisibleLogicalRange(r); } catch { /* ignore */ } });
    syncing.current = false;
  };

  const updateTimeAxes = () => {
    const panes = panesRef.current.filter(Boolean);
    panes.forEach((c, i) => c.applyOptions({ timeScale: { visible: i === panes.length - 1, timeVisible: true, secondsVisible: false } }));
  };

  // --- create main chart once -------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    const chart = createChart(el, {
      width: el.clientWidth, height: MAIN_H, ...baseOpts(),
      watermark: { visible: true, text: "TRADEFLOW", fontSize: 40, horzAlign: "center", vertAlign: "center", color: "rgba(130,140,160,0.09)", fontFamily: "ui-sans-serif, system-ui, sans-serif" },
    });
    chartRef.current = chart;
    panesRef.current = [chart];
    candleRef.current = chart.addCandlestickSeries({ upColor: cssVar("--up", "#26a69a"), downColor: cssVar("--down", "#ef5350"), wickUpColor: cssVar("--up", "#26a69a"), wickDownColor: cssVar("--down", "#ef5350"), borderVisible: false });
    volRef.current = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" } });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => syncFrom(chart));

    // drawing overlay
    const canvas = overlayRef.current, ctx = canvas.getContext("2d"), dpr = window.devicePixelRatio || 1;
    const sizeCanvas = () => { const w = el.clientWidth; canvas.width = w * dpr; canvas.height = MAIN_H * dpr; canvas.style.width = w + "px"; canvas.style.height = MAIN_H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const toX = (t) => chart.timeScale().timeToCoordinate(t);
    const toY = (p) => candleRef.current.priceToCoordinate(p);
    const fromPix = (x, y) => ({ time: chart.timeScale().coordinateToTime(x), value: candleRef.current.coordinateToPrice(y) });
    const accent = () => cssVar("--accent", "#5b82ff");

    const drawOne = (d) => {
      const w = el.clientWidth;
      ctx.lineWidth = 1.5; ctx.strokeStyle = accent(); ctx.fillStyle = "rgba(91,130,255,0.10)"; ctx.font = "10px ui-monospace, monospace";
      if (d.type === "hline") { const y = toY(d.a.value); if (y == null) return; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.fillStyle = accent(); ctx.fillText(d.a.value.toFixed(2), 4, y - 3); return; }
      if (d.type === "vline") { const x = toX(d.a.time); if (x == null) return; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAIN_H); ctx.stroke(); return; }
      const x1 = toX(d.a.time), y1 = toY(d.a.value), x2 = toX(d.b ? d.b.time : d.a.time), y2 = toY(d.b ? d.b.value : d.a.value);
      if ([x1, y1, x2, y2].some((v) => v == null)) return;
      if (d.type === "trend") { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
      else if (d.type === "ray") { const dx = x2 - x1, dy = y2 - y1; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + dx * 2000, y1 + dy * 2000); ctx.stroke(); }
      else if (d.type === "rect") { ctx.fillRect(x1, y1, x2 - x1, y2 - y1); ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); }
      else if (d.type === "measure") {
        ctx.fillStyle = "rgba(91,130,255,0.12)"; ctx.fillRect(x1, y1, x2 - x1, y2 - y1); ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        const dp = d.b.value - d.a.value, pctv = d.a.value ? (dp / d.a.value) * 100 : 0;
        ctx.fillStyle = accent(); ctx.font = "11px ui-sans-serif, system-ui";
        ctx.fillText(`${dp >= 0 ? "+" : ""}${dp.toFixed(2)}  (${pctv >= 0 ? "+" : ""}${pctv.toFixed(2)}%)`, Math.min(x1, x2) + 4, Math.min(y1, y2) - 4);
      } else if (d.type === "fib") {
        const hi = Math.max(d.a.value, d.b.value), lo = Math.min(d.a.value, d.b.value);
        FIB.forEach((f) => { const price = hi - (hi - lo) * f, y = toY(price); if (y == null) return; ctx.strokeStyle = "rgba(148,163,184,0.65)"; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.fillStyle = cssVar("--muted", "#8b93a7"); ctx.fillText(`${(f * 100).toFixed(1)}%  ${price.toFixed(2)}`, 4, y - 2); });
      }
    };
    const redraw = () => { ctx.clearRect(0, 0, el.clientWidth, MAIN_H); store.current.drawings.concat(store.current.pending ? [store.current.pending] : []).forEach(drawOne); };
    store.current.redraw = redraw;

    let dragging = null;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = (e) => {
      const t = toolRef.current; if (t === "cursor") return;
      const { x, y } = pos(e), pt = fromPix(x, y); if (pt.time == null || pt.value == null) return;
      if (t === "hline" || t === "vline") { store.current.drawings.push({ type: t, a: pt }); redraw(); }
      else { dragging = { type: t, a: pt, b: pt }; store.current.pending = dragging; redraw(); }
    };
    const onMove = (e) => { if (!dragging) return; const { x, y } = pos(e), pt = fromPix(x, y); if (pt.time == null || pt.value == null) return; dragging.b = pt; store.current.pending = dragging; redraw(); };
    const onUp = () => { if (dragging) { store.current.drawings.push(dragging); store.current.pending = null; dragging = null; redraw(); } };
    canvas.addEventListener("mousedown", onDown); window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const ro = new ResizeObserver(() => { chart.applyOptions({ width: el.clientWidth }); sizeCanvas(); redraw(); Object.values(oscRef.current).forEach((o) => o && o.chart.applyOptions({ width: el.clientWidth })); });
    ro.observe(el); sizeCanvas();

    return () => {
      ro.disconnect(); canvas.removeEventListener("mousedown", onDown); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
      Object.values(oscRef.current).forEach((o) => o && o.chart.remove()); oscRef.current = {};
      chart.remove(); chartRef.current = null;
    };
  }, []);

  // --- feed data ---------------------------------------------------------
  useEffect(() => {
    if (!chartRef.current || !candles?.length) return;
    const rows = candles.map((c) => ({ time: toTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
    rowsRef.current = rows;
    candleRef.current.setData(rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const up = cssVar("--up", "#26a69a"), down = cssVar("--down", "#ef5350");
    volRef.current.setData(showVol ? rows.map((r) => ({ time: r.time, value: r.volume, color: (r.close >= r.open ? up : down) + "55" })) : []);
    rebuildOverlays(rows);
    feedOscillators(rows);
    if (firstFit.current) { chartRef.current.timeScale().fitContent(); firstFit.current = false; }
    store.current.redraw?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, ov, bb, showVol, themeTick]);

  useEffect(() => { firstFit.current = true; store.current.drawings = []; store.current.pending = null; store.current.redraw?.(); }, [symbol]);

  function rebuildOverlays(rows) {
    const chart = chartRef.current;
    Object.values(ovRef.current).forEach((s) => { if (!s) return; if (s.upper) { chart.removeSeries(s.upper); chart.removeSeries(s.mid); chart.removeSeries(s.lower); } else chart.removeSeries(s); });
    ovRef.current = {};
    const addLine = (data, color, width = 1.5) => { const s = chart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); s.setData(data); return s; };
    OVERLAYS.forEach((o) => { if (ov[o.key]) ovRef.current[o.key] = addLine(o.make(rows), o.color); });
    if (bb) { const b = bollinger(rows, 20, 2); ovRef.current.bb = { upper: addLine(b.upper, "#94a3b8", 1), mid: addLine(b.mid, "#64748b", 1), lower: addLine(b.lower, "#94a3b8", 1) }; }
  }

  // --- oscillator sub-panes ---------------------------------------------
  function makeOsc(kind) {
    const host = kind === "rsi" ? rsiHostRef.current : macdHostRef.current;
    const chart = createChart(host, { width: wrapRef.current.clientWidth, height: OSC_H, ...baseOpts() });
    chart.timeScale().applyOptions({ visible: false });
    chart.priceScale("right").applyOptions({ borderColor: cssVar("--border", "#262c3a") });
    let series = {};
    if (kind === "rsi") {
      const line = chart.addLineSeries({ color: "#c084fc", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });
      line.createPriceLine({ price: 70, color: "rgba(239,83,80,.5)", lineStyle: LineStyle.Dashed, lineWidth: 1 });
      line.createPriceLine({ price: 30, color: "rgba(38,166,154,.5)", lineStyle: LineStyle.Dashed, lineWidth: 1 });
      series = { line };
    } else {
      const hist = chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
      const macd = chart.addLineSeries({ color: "#3b82f6", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const signal = chart.addLineSeries({ color: "#f5a623", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      series = { hist, macd, signal };
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => syncFrom(chart));
    oscRef.current[kind] = { chart, ...series };
    panesRef.current = [chartRef.current, oscRef.current.rsi?.chart, oscRef.current.macd?.chart].filter(Boolean);
    updateTimeAxes();
    // align to main range
    const r = chartRef.current.timeScale().getVisibleLogicalRange();
    if (r) chart.timeScale().setVisibleLogicalRange(r);
  }
  function killOsc(kind) {
    if (oscRef.current[kind]) { oscRef.current[kind].chart.remove(); delete oscRef.current[kind]; }
    panesRef.current = [chartRef.current, oscRef.current.rsi?.chart, oscRef.current.macd?.chart].filter(Boolean);
    updateTimeAxes();
  }
  function feedOscillators(rows) {
    if (oscRef.current.rsi) oscRef.current.rsi.line.setData(rsiSeries(rows, 14));
    if (oscRef.current.macd) { const m = macdSeries(rows); oscRef.current.macd.hist.setData(m.hist); oscRef.current.macd.macd.setData(m.macd); oscRef.current.macd.signal.setData(m.signal); }
  }
  // react to oscillator toggles
  useEffect(() => {
    ["rsi", "macd"].forEach((k) => {
      const host = k === "rsi" ? rsiHostRef.current : macdHostRef.current;
      if (osc[k] && !oscRef.current[k]) { host.style.display = "block"; makeOsc(k); }
      else if (!osc[k] && oscRef.current[k]) { killOsc(k); host.style.display = "none"; }
    });
    if (rowsRef.current.length) feedOscillators(rowsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osc]);

  // --- AI levels ---------------------------------------------------------
  useEffect(() => {
    const s = candleRef.current; if (!s) return;
    priceLinesRef.current.forEach((pl) => s.removePriceLine(pl)); priceLinesRef.current = [];
    if (levels?.support != null) priceLinesRef.current.push(s.createPriceLine({ price: levels.support, color: cssVar("--up", "#26a69a"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "support" }));
    if (levels?.resistance != null) priceLinesRef.current.push(s.createPriceLine({ price: levels.resistance, color: cssVar("--down", "#ef5350"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "resistance" }));
  }, [levels]);

  // --- theme -------------------------------------------------------------
  useEffect(() => {
    const apply = (c) => c && c.applyOptions({ layout: { textColor: cssVar("--muted", "#8b93a7") }, grid: { vertLines: { color: cssVar("--grid", "rgba(255,255,255,.05)") }, horzLines: { color: cssVar("--grid", "rgba(255,255,255,.05)") } }, rightPriceScale: { borderColor: cssVar("--border", "#262c3a") }, timeScale: { borderColor: cssVar("--border", "#262c3a") } });
    apply(chartRef.current); Object.values(oscRef.current).forEach((o) => apply(o?.chart));
    candleRef.current?.applyOptions({ upColor: cssVar("--up", "#26a69a"), downColor: cssVar("--down", "#ef5350"), wickUpColor: cssVar("--up", "#26a69a"), wickDownColor: cssVar("--down", "#ef5350") });
    store.current.redraw?.();
  }, [themeTick]);

  useEffect(() => { if (overlayRef.current) overlayRef.current.style.pointerEvents = tool === "cursor" ? "none" : "auto"; }, [tool]);
  const secondsHint = timeframe === "1m" || timeframe === "5m";
  useEffect(() => { panesRef.current.filter(Boolean).forEach((c, i, a) => c.applyOptions({ timeScale: { secondsVisible: secondsHint && i === a.length - 1 } })); }, [secondsHint]);

  const undo = () => { store.current.drawings.pop(); store.current.redraw?.(); };
  const clearAll = () => { store.current.drawings = []; store.current.pending = null; store.current.redraw?.(); };

  return (
    <div>
      <div className="chart-toolbar">
        <div className="tool-group">
          {TOOLS.map((t) => (
            <button key={t.key} className={`tool-btn ${tool === t.key ? "active" : ""}`} title={t.label} onClick={() => setTool(t.key)}><span aria-hidden>{t.icon}</span></button>
          ))}
          <span className="tool-sep" />
          <button className="tool-btn" title="Undo drawing" onClick={undo}>↶</button>
          <button className="tool-btn" title="Clear drawings" onClick={clearAll}>🗑</button>
        </div>
        <div className="tool-group ind-group">
          {OVERLAYS.map((o) => (
            <button key={o.key} className={`chip-toggle ${ov[o.key] ? "on" : ""}`} style={ov[o.key] ? { borderColor: o.color, color: o.color } : undefined} onClick={() => setOv((s) => ({ ...s, [o.key]: !s[o.key] }))}>{o.label}</button>
          ))}
          <button className={`chip-toggle ${bb ? "on" : ""}`} onClick={() => setBb((v) => !v)}>Bollinger</button>
          <span className="tool-sep" />
          <button className={`chip-toggle ${osc.rsi ? "on" : ""}`} onClick={() => setOsc((s) => ({ ...s, rsi: !s.rsi }))}>RSI</button>
          <button className={`chip-toggle ${osc.macd ? "on" : ""}`} onClick={() => setOsc((s) => ({ ...s, macd: !s.macd }))}>MACD</button>
          <button className={`chip-toggle ${showVol ? "on" : ""}`} onClick={() => setShowVol((v) => !v)}>Vol</button>
        </div>
      </div>
      <div className="chart-shell" style={{ position: "relative" }}>
        <div ref={wrapRef} style={{ width: "100%", height: MAIN_H }} />
        <canvas ref={overlayRef} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", cursor: "crosshair" }} />
      </div>
      <div ref={rsiHostRef} className="osc-pane" style={{ display: "none" }} data-label="RSI 14" />
      <div ref={macdHostRef} className="osc-pane" style={{ display: "none" }} data-label="MACD 12 26 9" />
    </div>
  );
}
