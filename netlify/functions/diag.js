// netlify/functions/diag.js
exports.handler = async (event) => {
  const origin = event.headers.origin || "*";
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "cache-control": "no-store",
  };

  const key = process.env.POLYGON_KEY || "";
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      hasPolygonKey: !!key,
      polygonKeyLen: key.length,
      // quick fingerprint so we know THIS file is deployed
      version: "diag-2025-08-31",
      node: process.version,
    }),
  };
};
