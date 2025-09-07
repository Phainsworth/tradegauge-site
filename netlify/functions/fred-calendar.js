// netlify/functions/fred-calendar.js
exports.handler = async (event) => {
  const origin = event.headers?.origin || "*";
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin,
    "cache-control": "no-store",
  };

  try {
    const apiKey = process.env.FRED_API_KEY || "";
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: "Missing FRED_API_KEY" }) };
    }

    const days = Math.max(1, Math.min(60, Number(event?.queryStringParameters?.days) || 14));
    const now = new Date();
    const end = new Date(now.getTime() + days * 86_400_000);
    const ymd = (d) => d.toISOString().slice(0, 10);

    // FRED releases/dates (includes future dates when include_release_dates_with_no_data=true)
    const url =
  "https://api.stlouisfed.org/fred/releases/dates"
  + `?api_key=${apiKey}`
  + "&file_type=json"
  + "&include_release_dates_with_no_data=true"
  + "&realtime_start=1776-07-04"
  + "&realtime_end=9999-12-31"
  + "&limit=10000";
    const r = await fetch(url);
    if (!r.ok) throw new Error(`FRED ${r.status}`);
    const j = await r.json();
    // DEBUG: return a peek at the raw FRED payload
if (event?.queryStringParameters?.debug === "1") {
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, sample: j.release_dates?.slice(0, 25) || null }),
  };
}

    const startMidnight = new Date(ymd(now) + "T00:00:00Z");
    const endMidnight = new Date(ymd(end) + "T23:59:59Z");

    // Map big releases to short names + risk
    const MAJORS = [
      [/Consumer Price Index/i, ["CPI", "HIGH"]],
      [/Employment Situation/i, ["Jobs Report", "HIGH"]],
      [/FOMC Press Release/i, ["FOMC", "HIGH"]],
      [/Gross Domestic Product/i, ["GDP", "HIGH"]],
      [/Personal Income and Outlays/i, ["PCE", "MED"]],
      [/Producer Price Index/i, ["PPI", "MED"]],
      [/Advance Monthly Sales for Retail and Food Services/i, ["Retail Sales", "MED"]],
      [/Unemployment Insurance Weekly Claims/i, ["Jobless Claims", "LOW"]],
      [/ISM/i, ["ISM", "MED"]],
    ];

    const events = (j.releases || [])
      .map((rd) => ({ name: rd.release_name, at: new Date(rd.date + "T12:00:00Z") })) // noon placeholder
      .filter((e) => e.at >= startMidnight && e.at <= endMidnight)
      .map((e) => {
        let title = e.name, risk = "LOW";
        for (const [re, [short, lvl]] of MAJORS) {
          if (re.test(e.name)) { title = short; risk = lvl; break; }
        }
        return { id: `${title}-${e.at.getTime()}`, type: "macro", title, at: e.at.toISOString(), risk };
      });

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, events }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
