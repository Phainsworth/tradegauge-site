// netlify/functions/_shared/guard.js
const ALLOWED = new Set([
  "https://www.tradegauge.io",
  "https://tradegauge.io",
  "https://lustrous-travesseiro-574bed.netlify.app", // your Netlify preview
  "http://localhost:5173", // vite dev (optional)
  "http://127.0.0.1:5173"
]);

function preflight(origin) {
  if (!origin || !ALLOWED.has(origin)) return {
    statusCode: 403,
    headers: { "content-type": "application/json", "access-control-allow-origin": origin || "*" },
    body: JSON.stringify({ ok:false, error:"forbidden_origin" })
  };
  return {
    statusCode: 200,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  };
}

function okHeaders(origin) {
  return {
    "content-type": "application/json",
    "access-control-allow-origin": origin
  };
}

module.exports = { preflight, okHeaders };
