// netlify/functions/polygon-proxy.js
const { preflight, okHeaders } = require("./_shared/guard");

exports.handler = async (event) => {
  const origin = event.headers.origin || "";
  if (event.httpMethod === "OPTIONS") return preflight(origin);
  const pre = preflight(origin);
  if (pre.statusCode !== 200) return pre;

  const qs = event.queryStringParameters || {};
  const rawPath = qs.path ? decodeURIComponent(qs.path) : ""; // <-- critical fix
  if (!rawPath) {
    return {
      statusCode: 400,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "missing_path" }),
    };
  }

  const API = "https://api.polygon.io";
  let u;
  try {
    u = new URL(API + rawPath);
  } catch (e) {
    return {
      statusCode: 400,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "bad_path", detail: String(e) }),
    };
  }

  // Copy any extra query params (if ever passed separately), without clobbering those already in rawPath
  for (const [k, v] of Object.entries(qs)) {
    if (k === "path") continue;
    if (!u.searchParams.has(k)) u.searchParams.set(k, v);
  }

  const apiKey = process.env.POLYGON_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "missing_server_polygon_key" }),
    };
  }
  u.searchParams.set("apiKey", apiKey);

  try {
    const r = await fetch(u.toString(), { method: "GET" }); // built-in fetch on Netlify
    const text = await r.text();
    return { statusCode: r.status, headers: okHeaders(origin), body: text };
  } catch (err) {
    return {
      statusCode: 502,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "upstream_fetch_failed", detail: String(err) }),
    };
  }
};
