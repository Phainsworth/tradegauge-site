import guardMod from "./_shared/guard.js";
const { preflight, okHeaders } = (guardMod?.default ?? guardMod);

// Netlify's Node has global fetch
export async function handler(event, context) {
  const origin = event.headers.origin || "";

  // CORS + preflight
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

  // Accept either OPENAI_API_KEY or OPENAI_KEY
  const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  if (!OPENAI_KEY) {
    console.error("[OPENAI] Missing OPENAI_API_KEY/OPENAI_KEY in Functions runtime");
    return {
      statusCode: 500,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "missing_OPENAI_KEY_runtime" }),
    };
  }

  // Parse body safely
  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    console.error("[OPENAI] Bad JSON body:", e?.message);
    return {
      statusCode: 400,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "bad_json" }),
    };
  }

  // Call OpenAI
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: payload.model || "gpt-4o-mini",
      temperature: payload.temperature ?? 0.3,
      max_tokens: payload.max_tokens ?? 800,
      messages: payload.messages || [],
    }),
  });

  const text = await r.text();
  if (!r.ok) {
    console.error("[OPENAI]", r.status, (text || "").slice(0, 400));
  }
  return { statusCode: r.status, headers: okHeaders(origin), body: text };
}
