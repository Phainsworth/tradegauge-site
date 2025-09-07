// netlify/functions/fred-calendar.js
// Fetch “major” US macro events from FRED without Finnhub.
// Plan: 1) Get all releases, 2) filter majors by name, 3) fetch dates per release_id (includes scheduled future dates)

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

    // horizon
    const days = Math.max(1, Math.min(120, Number(event?.queryStringParameters?.days) || 14));
    const now = new Date();
    const end = new Date(now.getTime() + days * 86_400_000);
    const ymd = (d) => d.toISOString().slice(0, 10);
    const startMidnight = new Date(ymd(now) + "T00:00:00Z");
    const endMidnight = new Date(ymd(end) + "T23:59:59Z");

    // 1) get all releases (id + name). Limit 1000 (FRED cap).
    const relUrl =
      "https://api.stlouisfed.org/fred/releases"
      + `?api_key=${apiKey}`
      + "&file_type=json"
      + "&limit=1000";
    const relR = await fetch(relUrl);
    if (!relR.ok) throw new Error(`FRED releases ${relR.status}`);
    const relJ = await relR.json();
    // Robust extraction (schema has 'releases')
    const releases = Array.isArray(relJ?.releases) ? relJ.releases : [];

    // 2) majors: map regex → [shortLabel, risk]
    const MAJORS = [
      [/Consumer Price Index/i, ["CPI", "HIGH"]],
      [/Personal Income and Outlays/i, ["PCE", "MED"]],
      [/Employment Situation/i, ["Jobs Report", "HIGH"]],
      [/Gross Domestic Product/i, ["GDP", "HIGH"]],
      [/Producer Price Index/i, ["PPI", "MED"]],
      [/Advance Monthly Sales for Retail and Food Services/i, ["Retail Sales", "MED"]],
      [/Unemployment Insurance Weekly Claims/i, ["Jobless Claims", "LOW"]],
      [/FOMC/i, ["FOMC", "HIGH"]],
      [/ISM/i, ["ISM", "MED"]],
    ];

    // pick only the releases we care about
    const picked = [];
    for (const r of releases) {
      const name = r?.name || r?.release_name || "";
      const id = r?.id ?? r?.release_id;
      if (!name || id == null) continue;
      for (const [re, meta] of MAJORS) {
        if (re.test(name)) {
          picked.push({ id, name, meta });
          break;
        }
      }
    }

    // 3) fetch dates per release (includes scheduled future dates with include_release_dates_with_no_data=true)
    const allDates = [];
    for (const p of picked) {
const dUrl =
  "https://api.stlouisfed.org/fred/release/dates"
  + `?api_key=${apiKey}`
  + "&file_type=json"
  + `&release_id=${encodeURIComponent(p.id)}`
  + "&include_release_dates_with_no_data=true"
  + "&sort_order=desc"   // <-- get most-recent + upcoming first
  + "&limit=200";        // <-- grab enough rows to include upcoming months
      const dR = await fetch(dUrl);
      if (!dR.ok) continue; // skip noisy release
      const dJ = await dR.json();
      const arr = Array.isArray(dJ?.release_dates) ? dJ.release_dates : [];
      for (const rd of arr) {
        const dateStr = rd?.date; // 'YYYY-MM-DD'
        if (!dateStr) continue;
        const at = new Date(dateStr + "T12:00:00Z"); // noon placeholder
        if (at >= startMidnight && at <= endMidnight) {
          const [short, risk] = p.meta;
          allDates.push({
            id: `${short}-${at.getTime()}`,
            type: "macro",
            title: short,
            at: at.toISOString(),
            risk,
            source: p.name, // full release name for tooltip
          });
        }
      }
    }

    // sort and uniq
    allDates.sort((a, b) => new Date(a.at) - new Date(b.at));
    const seen = new Set();
    const events = [];
    for (const e of allDates) {
      const key = e.title + "|" + e.at.slice(0, 10);
      if (!seen.has(key)) { seen.add(key); events.push(e); }
    }

    // Debug peek?
    if (event?.queryStringParameters?.debug === "1") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          picked: picked.map((p) => ({ id: p.id, name: p.name, short: p.meta[0] })),
          sample: events.slice(0, 10),
        }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, events }) };
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: String(err) }) };
  }
};
