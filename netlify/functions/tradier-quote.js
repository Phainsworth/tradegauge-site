// netlify/functions/tradier-quote.js
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    const token = process.env.TRADIER_TOKEN;
    const symbol = (event.queryStringParameters && event.queryStringParameters.symbol) || "";

    if (!token) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Missing TRADIER_TOKEN" }) };
    }
    if (!symbol) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing ?symbol" }) };
    }

    // Tradier expects OCC WITHOUT "O:" prefix
    const occ = symbol.startsWith("O:") ? symbol.slice(2) : symbol;

    const r = await fetch(`https://api.tradier.com/v1/markets/quotes?symbols=${encodeURIComponent(occ)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!r.ok) {
      return { statusCode: r.status, headers: CORS, body: JSON.stringify({ ok: false, status: r.status }) };
    }

    const j = await r.json();
    const q = j && j.quotes && j.quotes.quote;
    const row = Array.isArray(q) ? q[0] : q;

    const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

    const bid = num(row && row.bid);
    const ask = num(row && row.ask);
    const last = num(row && row.last);
    const mark =
      Number.isFinite(bid) && Number.isFinite(ask) && ask > 0
        ? (bid + ask) / 2
        : Number.isFinite(last)
        ? last
        : null;

    const greeks = row && row.greeks ? row.greeks : null;
    const iv =
      num(greeks && greeks.iv) ??
      num(greeks && greeks.mid_iv) ??
      num(row && row.implied_volatility) ??
      num(row && row.iv) ??
      null;
    const openInterest = num(row && row.open_interest) ?? null;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", ...CORS },
      body: JSON.stringify({
        ok: true,
        bid: Number.isFinite(bid) ? bid : null,
        ask: Number.isFinite(ask) ? ask : null,
        last: Number.isFinite(last) ? last : null,
        mark,
        greeks: greeks
          ? {
              delta: num(greeks.delta),
              gamma: num(greeks.gamma),
              theta: num(greeks.theta),
              vega: num(greeks.vega),
            }
          : null,
        iv,
        openInterest,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: String(e && (e.message || e)) }) };
  }
};
