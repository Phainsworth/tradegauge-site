// /netlify/functions/tradier-quote.js
import guardMod from "./_shared/guard.js";
const { preflight, okHeaders } = (guardMod?.default ?? guardMod);

// Accept TRADIER token from any of these names
function getTradierToken() {
  return (
    process.env.TRADIER_TOKEN ||
    process.env.TRADIER_KEY ||
    process.env.TRADIER_BEARER ||
    process.env.TRADIER_API_KEY
  );
}

// Build base URL (allows override), defaults to production API
const BASE = (process.env.TRADIER_BASE || "https://api.tradier.com/v1").replace(/\/+$/, "");

export async function handler(event) {
  const origin = event.headers.origin || "";

  // CORS / preflight
  if (event.httpMethod === "OPTIONS") return preflight(origin);
  const pre = preflight(origin);
  if (pre.statusCode !== 200) return pre;

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "GET_only" }),
    };
  }

  // --- read query
  const q = event.queryStringParameters || {};
  const symbol = (q.symbol || "").trim();
  const wantGreeks =
    q.greeks === "1" || q.greeks === "true" || q.greeks === "yes";

  if (!symbol) {
    return {
      statusCode: 400,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "missing_symbol" }),
    };
  }

  // --- auth
  const token = getTradierToken();
  if (!token) {
    console.error("[TRADIER] Missing token in Functions runtime");
    return {
      statusCode: 500,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "missing_TRADIER_TOKEN_runtime" }),
    };
  }

const url = `${BASE}/markets/quotes?symbols=${encodeURIComponent(
  symbol
)}${wantGreeks ? "&greeks=true" : ""}`;

  const r = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const text = await r.text();
  if (!r.ok) {
    console.error("[TRADIER]", r.status, (text || "").slice(0, 400));
    return {
      statusCode: r.status,
      headers: okHeaders(origin),
      body: text || JSON.stringify({ ok: false, error: "tradier_error" }),
    };
  }

  // --- normalize a single-quote response
  let j = {};
  try {
    j = JSON.parse(text);
  } catch (e) {
    console.error("[TRADIER] bad JSON:", e?.message);
    return { statusCode: 502, headers: okHeaders(origin), body: text };
  }

  // Tradier shape: { quotes: { quote: {...} } }  OR  { quotes: { quote: [ ... ] } }
  const qroot = j?.quotes?.quote;
  const quote = Array.isArray(qroot) ? qroot[0] : qroot || {};

  const b = Number(quote?.bid);
  const a = Number(quote?.ask);
  const l = Number(quote?.last);
  const mark =
    Number.isFinite(b) && Number.isFinite(a)
      ? (b + a) / 2
      : Number.isFinite(l)
      ? l
      : null;

  const greeks = quote?.greeks || null;
  const iv =
    Number.isFinite(greeks?.iv)
      ? greeks.iv
      : Number.isFinite(greeks?.smv_vol)
      ? greeks.smv_vol
      : 0;

  const openInterest = Number.isFinite(quote?.open_interest)
    ? quote.open_interest
    : null;

  const body = {
    ok: true,
    bid: Number.isFinite(b) ? b : null,
    ask: Number.isFinite(a) ? a : null,
    last: Number.isFinite(l) ? l : null,
    mark,
    greeks,
    iv,
    openInterest,
    raw: quote, // helpful for debugging in console
  };

  return { statusCode: 200, headers: okHeaders(origin), body: JSON.stringify(body) };
}
