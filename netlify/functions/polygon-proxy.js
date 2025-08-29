// netlify/functions/polygon-proxy.js
export async function handler(event) {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: "Method Not Allowed",
    };
  }

  try {
    const key = process.env.POLYGON_KEY;
    if (!key) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "POLYGON_KEY missing",
      };
    }

    // Expect body like: { path: "v3/snapshot/options/AAPL", searchParams: { include: "greeks", limit: 50 } }
    const { path, searchParams } = JSON.parse(event.body || "{}");
    if (!path || typeof path !== "string") {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "Missing 'path' (e.g. 'v3/snapshot/options/AAPL')",
      };
    }

    const params = new URLSearchParams();
    if (searchParams && typeof searchParams === "object") {
      for (const [k, v] of Object.entries(searchParams)) {
        if (v !== undefined && v !== null) params.append(k, String(v));
      }
    }
    params.append("apiKey", key);

    const url = `https://api.polygon.io/${path}?${params.toString()}`;

    const resp = await fetch(url);
    const text = await resp.text(); // pass through raw in case of non-JSON errors

    return {
      statusCode: resp.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": resp.headers.get("content-type") || "application/json",
      },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: `Server error: ${err.message}`,
    };
  }
}
