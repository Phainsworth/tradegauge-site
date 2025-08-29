const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const { preflight, okHeaders } = require('./_shared/guard');

exports.handler = async (event) => {
  const origin = event.headers.origin || "";
  if (event.httpMethod === "OPTIONS") return preflight(origin);
  const pre = preflight(origin);
  if (pre.statusCode !== 200) return pre;

  const { path = "", ...q } = event.queryStringParameters || {};
  if (!path) return { statusCode:400, headers: okHeaders(origin), body: JSON.stringify({ ok:false, error:"missing_path"})};

  const API = "https://finnhub.io/api/v1";
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  u.searchParams.set("token", process.env.FINNHUB_KEY);

  const r = await fetch(u.toString());
  const text = await r.text();
  return { statusCode: r.status, headers: okHeaders(origin), body: text };
};
