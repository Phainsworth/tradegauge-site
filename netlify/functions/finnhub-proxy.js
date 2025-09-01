// netlify/functions/finnhub-proxy.js
const { preflight, okHeaders } = require("./_shared/guard");

exports.handler = async (event) => {
  const origin = event.headers.origin || "";
  if (event.httpMethod === "OPTIONS") return preflight(origin);
  const pre = preflight(origin);
  if (pre.statusCode !== 200) return pre;

  const qs = event.queryStringParameters || {};
  const rawPath = qs.path ? decodeURIComponent(qs.path) : "";

  const token = (
  process.env.FINNHUB_KEY ||
  process.env.FINNHUB_TOKEN ||
  process.env.FINNHUB_API_KEY ||
  ""
).trim();
  const hasKey = token.length > 0;

  // Safe echo for runtime verification (no token leaked)
  // GET /.netlify/functions/finnhub-proxy?echo=1
  if (qs.echo === "1") {
    return {
      statusCode: 200,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: true, hasKey, keyLen: token.length, base: "https://finnhub.io/api/v1" }),
    };
  }

  if (!rawPath) {
    return { statusCode: 400, headers: okHeaders(origin), body: JSON.stringify({ ok:false, error:"missing_path" }) };
  }
  if (!hasKey) {
    return { statusCode: 500, headers: okHeaders(origin), body: JSON.stringify({ ok:false, error:"missing_server_finnhub_key" }) };
  }

  let u;
  try {
    u = new URL("https://finnhub.io/api/v1" + rawPath);
  } catch (e) {
    return { statusCode: 400, headers: okHeaders(origin), body: JSON.stringify({ ok:false, error:"bad_path", detail:String(e) }) };
  }

  // Carry through extra query params without stomping existing
  for (const [k, v] of Object.entries(qs)) {
    if (k === "path" || k === "echo") continue;
    if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  }

  // Send token both ways (query + header) to avoid provider quirks
  u.searchParams.set("token", token);

  try {
    const r = await fetch(u.toString(), { headers: { "X-Finnhub-Token": token } });
    const text = await r.text();
    return { statusCode: r.status, headers: okHeaders(origin), body: text };
  } catch (err) {
    return { statusCode: 502, headers: okHeaders(origin), body: JSON.stringify({ ok:false, error:"upstream_fetch_failed", detail:String(err) }) };
  }
};
