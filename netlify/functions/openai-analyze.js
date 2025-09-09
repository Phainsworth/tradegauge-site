// netlify/functions/openai-analyze.js
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
  let userHints = [];
  try {
    payload = JSON.parse(event.body || "{}");

    // Extract hints (optional)
    userHints = Array.isArray(payload?.context?.hints)
      ? payload.context.hints.filter(Boolean)
      : [];
  } catch (e) {
    console.error("[OPENAI] Bad JSON body:", e?.message);
    return {
      statusCode: 400,
      headers: okHeaders(origin),
      body: JSON.stringify({ ok: false, error: "bad_json" }),
    };
  }

  // Build messages: clone to avoid mutating caller state
  const messages = Array.isArray(payload.messages) ? payload.messages.map(m => ({ ...m })) : [];

  // If we have at least one message, merge hints into the last *user* message
  if (messages.length && userHints.length) {
    // Find last user message; if none, fallback to last message
    let idx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") { idx = i; break; }
    }
    if (idx === -1) idx = messages.length - 1;

    const last = messages[idx];
    const content = last?.content;

    if (typeof content === "string") {
      try {
        // If it's JSON, merge hints under context.hints
        const parsed = JSON.parse(content);
        const merged = {
          ...parsed,
          context: {
            ...(parsed.context || {}),
            hints: userHints,
          },
        };
        last.content = JSON.stringify(merged);
      } catch {
        // If not JSON, append a simple Hints section
        last.content = `${content}\n\nHints:\n${userHints.join("\n")}`;
      }
    }
  }

  // Pass-through options (keep it tight; forward what you actually use)
  const model = payload.model || "gpt-4o-mini";
  const temperature = typeof payload.temperature === "number" ? payload.temperature : 0.3;
  const max_tokens = typeof payload.max_tokens === "number" ? payload.max_tokens : 800;

  // IMPORTANT: forward response_format if present (so frontend gets JSON!)
  const bodyOut = {
    model,
    temperature,
    max_tokens,
    messages,
  };
  if (payload.response_format) {
    bodyOut.response_format = payload.response_format;
  }

  // Call OpenAI
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify(bodyOut),
  });

  const text = await r.text();
  if (!r.ok) {
    console.error("[OPENAI]", r.status, (text || "").slice(0, 400));
  }

  return { statusCode: r.status, headers: okHeaders(origin), body: text };
}
