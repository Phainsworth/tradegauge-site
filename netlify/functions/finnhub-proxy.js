// netlify/functions/finnhub-proxy.js
export async function handler(event) {
  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: "Missing FINNHUB_API_KEY" };
    }

    // Expect ?path=/calendar/economic?from=2025-08-01&to=2025-08-31 ... etc
    const url = new URL(event.rawUrl);
    const path = url.searchParams.get("path"); // full finnhub path + query (without base)
    if (!path || !path.startsWith("/")) {
      return { statusCode: 400, body: "Invalid 'path' param" };
    }

    const finnhubUrl = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${apiKey}`;
    const resp = await fetch(finnhubUrl);
    const data = await resp.text();

    return {
      statusCode: resp.status,
      headers: { "content-type": resp.headers.get("content-type") || "application/json" },
      body: data
    };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
}
