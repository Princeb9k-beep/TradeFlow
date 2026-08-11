import { useState } from "react";
import { api, setToken } from "../api/client.js";

export default function Login({ onAuthed, notify }) {
  const [mode, setMode] = useState("signup");
  const [form, setForm] = useState({ email: "", password: "", name: "", experience: "new" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = mode === "signup"
        ? await api.signup(form)
        : await api.login({ email: form.email, password: form.password });
      setToken(data.token);
      notify(mode === "signup" ? "Welcome to Tradeflow" : "Signed in", "success");
      onAuthed(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand"><span className="brand"><span className="glyph">◪</span></span> Tradeflow</div>
        <p className="auth-sub">Learn to trade, and trade smarter — with an AI coach at the chart.</p>
        <div className="card">
          <div className="seg">
            <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create account</button>
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign in</button>
          </div>
          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>Name<input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Your name" /></label>
            )}
            <label>Email<input type="email" required value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="you@example.com" /></label>
            <label>Password<input type="password" required minLength={8} value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="At least 8 characters" /></label>
            {mode === "signup" && (
              <label>I'm a…
                <select value={form.experience} onChange={(e) => set("experience", e.target.value)}>
                  <option value="new">New trader — teach me</option>
                  <option value="experienced">Experienced trader</option>
                </select>
              </label>
            )}
            {error && <div className="state state-error" style={{ marginBottom: 12 }}>{error}</div>}
            <button className="btn" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>
        <p className="fine" style={{ textAlign: "center", marginTop: 16 }}>
          Educational tool — paper trading on synthetic data. Not financial advice.
        </p>
      </div>
    </div>
  );
}
