import { preflight, okHeaders } from "./_shared/guard.js"; // note the .js
// no node-fetch needed; Netlify's Node runtime has global fetch

export async function handler(event, context) {
  const origin = event.headers.origin || "";
  if (event.httpMethod === "OPTIONS") return preflight(origin);
  const pre = preflight(origin);
  if (pre.statusCode !== 200) return pre;

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "POST_only" }),
    };
  }

  const payload = JSON.parse(event.body || "{}");

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: payload.model || "gpt-4o-mini",
      temperature: payload.temperature ?? 0.3,
      max_tokens: payload.max_tokens ?? 800,
      messages: payload.messages || [],
    }),
  });

  const text = await r.text();
  return { statusCode: r.status, headers: okHeaders(origin), body: text };
}
