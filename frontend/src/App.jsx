import { useCallback, useEffect, useRef, useState } from "react";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api/client.js";
import Login from "./pages/Login.jsx";
import Trade from "./pages/Trade.jsx";

function useToast() {
  const ref = useRef(null);
  const notify = useCallback((msg) => {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(ref.current);
    ref.current = setTimeout(() => el.classList.remove("show"), 2200);
  }, []);
  return notify;
}

export default function App() {
  const notify = useToast();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setUser(null); });
    if (!getToken()) { setLoading(false); return; }
    api.me().then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  function toggleTheme() {
    const root = document.documentElement;
    let cur = root.getAttribute("data-theme");
    if (!cur) cur = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
    window.dispatchEvent(new Event("theme:changed"));
  }

  function logout() { setToken(null); setUser(null); notify("Signed out"); }

  if (loading) return <div className="state" style={{ paddingTop: 80 }}>Loading…</div>;

  if (!user) {
    return (
      <>
        <Login onAuthed={setUser} notify={notify} />
        <div id="toast" />
      </>
    );
  }

  return (
    <>
      <div className="topbar">
        <div className="brand"><span className="glyph">◪</span> Tradeflow</div>
        <span className="mode-pill">● Paper</span>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>{user.name || user.email}</span>
        <button className="icon-btn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">◐</button>
        <button className="btn ghost" onClick={logout} style={{ padding: "6px 12px" }}>Sign out</button>
      </div>
      <div className="disclaimer-strip">
        Paper trading on {import.meta.env.VITE_API_BASE_URL ? "live" : "synthetic"} market data · educational only — not financial advice
      </div>
      <div className="wrap">
        <Trade notify={notify} />
      </div>
      <div id="toast" />
    </>
  );
}
