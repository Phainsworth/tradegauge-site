const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const { preflight, okHeaders } = require('./_shared/guard');

exports.handler = async (event) => {
  const origin = event.headers.origin || "";
  if (event.httpMethod === "OPTIONS") return preflight(origin);
  const pre = preflight(origin);
  if (pre.statusCode !== 200) return pre;

  const { path = "/v1/markets/quotes", ...q } = event.queryStringParameters || {};
  const API = "https://api.tradier.com";
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);

  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${process.env.TRADIER_TOKEN}`, Accept: "application/json" }
  });
  const text = await r.text();
  return { statusCode: r.status, headers: okHeaders(origin), body: text };
};
