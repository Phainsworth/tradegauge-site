// netlify/functions/_shared/guard.js
const ALLOWED = new Set([
  "https://www.tradegauge.io",
  "https://tradegauge.io",
  "https://lustrous-travesseiro-574bed.netlify.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function forbidden(origin) {
  return {
    statusCode: 403,
    headers: { "content-type": "application/json", "access-control-allow-origin": origin || "*" },
    body: JSON.stringify({ ok: false, error: "forbidden_origin" }),
  };
}

function okHeaders(origin) {
  return {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin || "*",              // allow if no Origin header
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "cache-control": "no-store",
  };
}

function preflight(origin) {
  // If an Origin header exists AND it's not allowed, block. Otherwise allow.
  if (origin && !ALLOWED.has(origin)) return forbidden(origin);
  return { statusCode: 200, headers: okHeaders(origin), body: "" };
}

module.exports = { preflight, okHeaders };
