// netlify/functions/diag.js
exports.handler = async (event) => {
  const origin = event.headers.origin || "*";
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "cache-control": "no-store",
  };

  const key = process.env.POLYGON_KEY || "";
  const first4 = key ? key.slice(0, 4) : "";
  const last4  = key ? key.slice(-4) : "";

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      hasPolygonKey: !!key,
      polygonKeyLen: key.length,
      first4,
      last4,
      version: "diag-2025-08-31b",
      node: process.version,
    }),
  };
};
