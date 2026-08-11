// Central API client. The backend always returns the envelope
// { success, data, message, meta }; this unwraps it, throwing an Error with the
// human-readable message on failure. Auth is a JWT Bearer token in localStorage.

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const TOKEN_KEY = "tradeflow_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 401 && auth && onUnauthorized) onUnauthorized();

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error("Unexpected response from the server.");
  }
  if (!res.ok || payload.success === false) {
    throw new Error(payload?.message || "Something went wrong.");
  }
  return payload.data;
}

export const api = {
  // auth
  signup: (data) => request("/auth/signup", { method: "POST", body: data, auth: false }),
  login: (data) => request("/auth/login", { method: "POST", body: data, auth: false }),
  me: () => request("/auth/me"),
  // trading
  tradeQuote: (s) => request(`/trading/quote/${encodeURIComponent(s)}`),
  tradeCandles: (s, tf = "1d", limit = 120) =>
    request(`/trading/candles/${encodeURIComponent(s)}?timeframe=${tf}&limit=${limit}`),
  tradeWatchlist: () => request("/trading/watchlist"),
  tradeAddWatch: (symbol) => request("/trading/watchlist", { method: "POST", body: { symbol } }),
  tradeRemoveWatch: (s) => request(`/trading/watchlist/${encodeURIComponent(s)}`, { method: "DELETE" }),
  tradeAccount: () => request("/trading/account"),
  tradeAccountSettings: (data) => request("/trading/account/settings", { method: "POST", body: data }),
  tradeOrder: (symbol, side, quantity, note) =>
    request("/trading/orders", { method: "POST", body: { symbol, side, quantity, note } }),
  tradeOrders: () => request("/trading/orders"),
  tradeAnalyze: (s, tf = "1d") => request(`/trading/analyze/${encodeURIComponent(s)}?timeframe=${tf}`),
  tradeScreen: (query, symbols = []) => request("/trading/screen", { method: "POST", body: { query, symbols } }),
  tradePositionSize: (data) => request("/trading/position-size", { method: "POST", body: data }),
  tradeJournal: () => request("/trading/journal"),
  tradeAddJournal: (data) => request("/trading/journal", { method: "POST", body: data }),
  tradeReviewJournal: (id) => request(`/trading/journal/${id}/review`, { method: "POST" }),
  tradeDeleteJournal: (id) => request(`/trading/journal/${id}`, { method: "DELETE" }),
  tradeAcademy: () => request("/trading/academy"),
};
