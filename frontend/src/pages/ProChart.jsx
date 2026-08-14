// ProChart — a TradingView-style chart built on lightweight-charts.
//
// Gives the real thing: zoom, pan, crosshair, auto-scaling time/price axes, a
// volume histogram, toggleable overlay indicators (SMA/EMA/Bollinger), and a
// drawing layer (trendline, horizontal line, rectangle, Fib retracement) rendered
// on a canvas overlay that stays anchored to price/time as you pan and zoom.
// AI support/resistance come in as dashed price lines.

import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

const toTime = (iso) => Math.floor(Date.parse(iso) / 1000);

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// --- indicator math ------------------------------------------------------
function sma(rows, period) {
  const out = [];
  for (let i = period - 1; i < rows.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += rows[j].close;
    out.push({ time: rows[i].time, value: +(s / period).toFixed(4) });
  }
  return out;
}
function ema(rows, period) {
  if (rows.length < period) return [];
  const k = 2 / (period + 1);
  let e = rows.slice(0, period).reduce((a, r) => a + r.close, 0) / period;
  const out = [{ time: rows[period - 1].time, value: +e.toFixed(4) }];
  for (let i = period; i < rows.length; i++) {
    e = rows[i].close * k + e * (1 - k);
    out.push({ time: rows[i].time, value: +e.toFixed(4) });
  }
  return out;
}
function bollinger(rows, period = 20, mult = 2) {
  const upper = [], mid = [], lower = [];
  for (let i = period - 1; i < rows.length; i++) {
    const win = rows.slice(i - period + 1, i + 1).map((r) => r.close);
    const m = win.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / period);
    mid.push({ time: rows[i].time, value: +m.toFixed(4) });
    upper.push({ time: rows[i].time, value: +(m + mult * sd).toFixed(4) });
    lower.push({ time: rows[i].time, value: +(m - mult * sd).toFixed(4) });
  }
  return { upper, mid, lower };
}

const TOOLS = [
  { key: "cursor", label: "Cursor", icon: "⌖" },
  { key: "trend", label: "Trend line", icon: "╱" },
  { key: "hline", label: "Horizontal", icon: "─" },
  { key: "rect", label: "Rectangle", icon: "▭" },
  { key: "fib", label: "Fib retracement", icon: "𝑓" },
];
const IND = [
  { key: "sma20", label: "SMA 20", color: "#f5a623" },
  { key: "sma50", label: "SMA 50", color: "#3b82f6" },
  { key: "sma200", label: "SMA 200", color: "#a855f7" },
  { key: "ema21", label: "EMA 21", color: "#22d3ee" },
  { key: "bb", label: "Bollinger", color: "#94a3b8" },
];
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export default function ProChart({ candles, levels, symbol, themeTick }) {
  const wrapRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volRef = useRef(null);
  const indRef = useRef({});          // key -> series (or {upper,mid,lower})
  const priceLinesRef = useRef([]);
  const overlayRef = useRef(null);
  const store = useRef({ drawings: [], pending: null });
  const toolRef = useRef("cursor");
  const firstFit = useRef(true);

  const [tool, setTool] = useState("cursor");
  const [ind, setInd] = useState({ sma20: true, sma50: true, sma200: false, ema21: false, bb: false });
  const [showVol, setShowVol] = useState(true);

  useEffect(() => { toolRef.current = tool; }, [tool]);

  // --- create chart once -------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 440,
      // Pin the locale so axis/price formatting never depends on a host locale
      // the browser's Intl can't parse.
      localization: { locale: "en-US" },
      // Our brand, not the library's: hide the attribution logo, show a faint
      // Tradeflow watermark instead.
      watermark: {
        visible: true,
        text: "TRADEFLOW",
        fontSize: 42,
        horzAlign: "center",
        vertAlign: "center",
        color: "rgba(130,140,160,0.10)",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      },
      layout: {
        background: { color: "transparent" },
        textColor: cssVar("--muted", "#8b93a7"),
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        attributionLogo: false,
      },
      grid: { vertLines: { color: cssVar("--grid", "rgba(255,255,255,.05)") }, horzLines: { color: cssVar("--grid", "rgba(255,255,255,.05)") } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: cssVar("--border", "#262c3a") },
      timeScale: { borderColor: cssVar("--border", "#262c3a"), timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;
    candleRef.current = chart.addCandlestickSeries({
      upColor: cssVar("--up", "#26a69a"), downColor: cssVar("--down", "#ef5350"),
      wickUpColor: cssVar("--up", "#26a69a"), wickDownColor: cssVar("--down", "#ef5350"),
      borderVisible: false,
    });
    volRef.current = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" } });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    // --- drawing overlay ---
    const canvas = overlayRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const sizeCanvas = () => {
      const w = el.clientWidth, h = 440;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const toX = (t) => chart.timeScale().timeToCoordinate(t);
    const toY = (p) => candleRef.current.priceToCoordinate(p);
    const fromPix = (x, y) => ({ time: chart.timeScale().coordinateToTime(x), value: candleRef.current.coordinateToPrice(y) });

    const drawOne = (d) => {
      const w = el.clientWidth;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = cssVar("--accent", "#5b82ff");
      ctx.fillStyle = "rgba(91,130,255,0.10)";
      ctx.font = "10px ui-monospace, monospace";
      if (d.type === "hline") {
        const y = toY(d.a.value); if (y == null) return;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.fillStyle = cssVar("--accent", "#5b82ff");
        ctx.fillText(d.a.value.toFixed(2), 4, y - 3);
      } else if (d.type === "trend") {
        const x1 = toX(d.a.time), y1 = toY(d.a.value), x2 = toX(d.b.time), y2 = toY(d.b.value);
        if ([x1, y1, x2, y2].some((v) => v == null)) return;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      } else if (d.type === "rect") {
        const x1 = toX(d.a.time), y1 = toY(d.a.value), x2 = toX(d.b.time), y2 = toY(d.b.value);
        if ([x1, y1, x2, y2].some((v) => v == null)) return;
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      } else if (d.type === "fib") {
        const hi = Math.max(d.a.value, d.b.value), lo = Math.min(d.a.value, d.b.value);
        FIB.forEach((f) => {
          const price = hi - (hi - lo) * f;
          const y = toY(price); if (y == null) return;
          ctx.strokeStyle = "rgba(148,163,184,0.7)";
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          ctx.fillStyle = cssVar("--muted", "#8b93a7");
          ctx.fillText(`${(f * 100).toFixed(1)}%  ${price.toFixed(2)}`, 4, y - 2);
        });
      }
    };
    const redraw = () => {
      ctx.clearRect(0, 0, el.clientWidth, 440);
      const all = store.current.drawings.concat(store.current.pending ? [store.current.pending] : []);
      all.forEach(drawOne);
    };
    store.current.redraw = redraw;

    // Pointer handlers (only active when a drawing tool is selected).
    let dragging = null;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onDown = (e) => {
      if (toolRef.current === "cursor") return;
      const { x, y } = pos(e); const pt = fromPix(x, y);
      if (pt.time == null || pt.value == null) return;
      if (toolRef.current === "hline") {
        store.current.drawings.push({ type: "hline", a: pt }); redraw();
      } else {
        dragging = { type: toolRef.current, a: pt, b: pt };
        store.current.pending = dragging; redraw();
      }
    };
    const onMove = (e) => {
      if (!dragging) return;
      const { x, y } = pos(e); const pt = fromPix(x, y);
      if (pt.time == null || pt.value == null) return;
      dragging.b = pt; store.current.pending = dragging; redraw();
    };
    const onUp = () => {
      if (dragging) { store.current.drawings.push(dragging); store.current.pending = null; dragging = null; redraw(); }
    };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const ro = new ResizeObserver(() => { chart.applyOptions({ width: el.clientWidth }); sizeCanvas(); redraw(); });
    ro.observe(el);
    sizeCanvas();

    return () => {
      ro.disconnect();
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // --- feed data ---------------------------------------------------------
  useEffect(() => {
    if (!chartRef.current || !candles?.length) return;
    const rows = candles.map((c) => ({ time: toTime(c.t), open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v }));
    candleRef.current.setData(rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const up = cssVar("--up", "#26a69a"), down = cssVar("--down", "#ef5350");
    volRef.current.setData(showVol ? rows.map((r) => ({ time: r.time, value: r.volume, color: (r.close >= r.open ? up : down) + "66" })) : []);
    rebuildIndicators(rows);
    if (firstFit.current) { chartRef.current.timeScale().fitContent(); firstFit.current = false; }
    store.current.redraw && store.current.redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, ind, showVol, themeTick]);

  // New symbol → refit and clear this symbol's drawings.
  useEffect(() => {
    firstFit.current = true;
    store.current.drawings = []; store.current.pending = null;
    store.current.redraw && store.current.redraw();
  }, [symbol]);

  function rebuildIndicators(rows) {
    const chart = chartRef.current;
    // clear existing
    Object.values(indRef.current).forEach((s) => {
      if (!s) return;
      if (s.upper) { chart.removeSeries(s.upper); chart.removeSeries(s.mid); chart.removeSeries(s.lower); }
      else chart.removeSeries(s);
    });
    indRef.current = {};
    const addLine = (data, color, width = 1.5) => {
      const s = chart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(data); return s;
    };
    if (ind.sma20) indRef.current.sma20 = addLine(sma(rows, 20), "#f5a623");
    if (ind.sma50) indRef.current.sma50 = addLine(sma(rows, 50), "#3b82f6");
    if (ind.sma200) indRef.current.sma200 = addLine(sma(rows, 200), "#a855f7");
    if (ind.ema21) indRef.current.ema21 = addLine(ema(rows, 21), "#22d3ee");
    if (ind.bb) {
      const bb = bollinger(rows, 20, 2);
      indRef.current.bb = { upper: addLine(bb.upper, "#94a3b8", 1), mid: addLine(bb.mid, "#64748b", 1), lower: addLine(bb.lower, "#94a3b8", 1) };
    }
  }

  // --- AI support/resistance as price lines ------------------------------
  useEffect(() => {
    const s = candleRef.current;
    if (!s) return;
    priceLinesRef.current.forEach((pl) => s.removePriceLine(pl));
    priceLinesRef.current = [];
    if (levels?.support != null) priceLinesRef.current.push(s.createPriceLine({ price: levels.support, color: cssVar("--up", "#26a69a"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "support" }));
    if (levels?.resistance != null) priceLinesRef.current.push(s.createPriceLine({ price: levels.resistance, color: cssVar("--down", "#ef5350"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "resistance" }));
  }, [levels]);

  // --- theme reapply -----------------------------------------------------
  useEffect(() => {
    const chart = chartRef.current; if (!chart) return;
    chart.applyOptions({
      layout: { textColor: cssVar("--muted", "#8b93a7") },
      grid: { vertLines: { color: cssVar("--grid", "rgba(255,255,255,.05)") }, horzLines: { color: cssVar("--grid", "rgba(255,255,255,.05)") } },
      rightPriceScale: { borderColor: cssVar("--border", "#262c3a") },
      timeScale: { borderColor: cssVar("--border", "#262c3a") },
    });
    candleRef.current.applyOptions({ upColor: cssVar("--up", "#26a69a"), downColor: cssVar("--down", "#ef5350"), wickUpColor: cssVar("--up", "#26a69a"), wickDownColor: cssVar("--down", "#ef5350") });
    store.current.redraw && store.current.redraw();
  }, [themeTick]);

  // overlay only captures the mouse when a drawing tool is active
  useEffect(() => {
    if (overlayRef.current) overlayRef.current.style.pointerEvents = tool === "cursor" ? "none" : "auto";
  }, [tool]);

  function undo() { store.current.drawings.pop(); store.current.redraw && store.current.redraw(); }
  function clearAll() { store.current.drawings = []; store.current.pending = null; store.current.redraw && store.current.redraw(); }

  return (
    <div>
      <div className="chart-toolbar">
        <div className="tool-group">
          {TOOLS.map((t) => (
            <button key={t.key} className={`tool-btn ${tool === t.key ? "active" : ""}`} title={t.label} onClick={() => setTool(t.key)}>
              <span aria-hidden>{t.icon}</span>
            </button>
          ))}
          <button className="tool-btn" title="Undo last drawing" onClick={undo}>↶</button>
          <button className="tool-btn" title="Clear drawings" onClick={clearAll}>🗑</button>
        </div>
        <div className="tool-group ind-group">
          {IND.map((i) => (
            <button key={i.key} className={`chip-toggle ${ind[i.key] ? "on" : ""}`} style={ind[i.key] ? { borderColor: i.color, color: i.color } : undefined} onClick={() => setInd((s) => ({ ...s, [i.key]: !s[i.key] }))}>
              {i.label}
            </button>
          ))}
          <button className={`chip-toggle ${showVol ? "on" : ""}`} onClick={() => setShowVol((v) => !v)}>Volume</button>
        </div>
      </div>
      <div className="chart-shell" style={{ position: "relative" }}>
        <div ref={wrapRef} style={{ width: "100%", height: 440 }} />
        <canvas ref={overlayRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", cursor: "crosshair" }} />
      </div>
    </div>
  );
}
