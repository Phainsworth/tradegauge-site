// netlify/functions/openai-analyze.js
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    const OPENAI_KEY = process.env.OPENAI_KEY;
    if (!OPENAI_KEY) {
      return { statusCode: 500, body: "OPENAI_KEY missing" };
    }

    const payload = JSON.parse(event.body || "{}"); // { messages, model?, temperature? }
    // Minimal guard
    if (!Array.isArray(payload.messages)) {
      return { statusCode: 400, body: "messages[] required" };
    }

    // Call OpenAI (Responses API or Chat Completions; using responses here)
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: payload.messages, // or build from your existing structure
        temperature: payload.temperature ?? 0.2,
      }),
    });

    const data = await resp.json();
    return {
      statusCode: resp.ok ? 200 : resp.status,
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: 500, body: `Server error: ${err.message}` };
  }
}
