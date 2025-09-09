// netlify/functions/fomc-schedule.js
// Free source: scrape the official FOMC calendars page for upcoming meeting dates
// Outputs: { ok: true, events: [{title, date:"YYYY-MM-DD", time:"HH:MM"}] }
exports.handler = async () => {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  };
  try {
    const url = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error("fed page " + res.status);
    const html = await res.text();

    // Find patterns like: September 16–17, 2025  OR September 16-17, 2025
    const rx = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*(?:–|-)\s*\d{1,2},\s*\d{4}/g;
    const found = Array.from(html.matchAll(rx)).map(m => m[0]);
    if (!found.length) throw new Error("no meeting ranges found");

    const monthIdx = {
      January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
      July: 6, August: 7, September: 8, October: 9, November: 10, December: 11
    };

    // Convert range string to ISO decision date (the later day, i.e., Wednesday)
    const toDecisionISO = (s) => {
      const m = s.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*(?:–|-)\s*(\d{1,2}),\s*(\d{4})/);
      if (!m) return null;
      const monthName = m[1];
      const d2 = parseInt(m[3], 10);
      const year = parseInt(m[4], 10);
      const month = monthIdx[monthName];
      const dt = new Date(year, month, d2);
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    // Choose the next upcoming decision date >= today
    const today = new Date();
    let chosen = null;
    for (const s of found) {
      const iso = toDecisionISO(s);
      if (!iso) continue;
      const dt = new Date(iso + "T00:00:00");
      if (dt >= new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
        chosen = iso;
        break;
      }
    }
    // If all were in the past, take the last one
    if (!chosen) chosen = toDecisionISO(found[found.length - 1]);

    // Build events for decision day
    const monthNum = parseInt(chosen.slice(5,7), 10); // 1..12
    const sepMonths = new Set([3, 6, 9, 12]); // Mar, Jun, Sep, Dec = Economic Projections

    const out = [
      { title: "FOMC Statement", date: chosen, time: "14:00" },
      { title: "Federal Funds Rate (Target Range)", date: chosen, time: "14:00" },
      ...(sepMonths.has(monthNum) ? [{ title: "FOMC Economic Projections", date: chosen, time: "14:00" }] : []),
      { title: "FOMC Press Conference", date: chosen, time: "14:30" },
    ];

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, events: out }) };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: false, error: String((err && err.message) || err) })
    };
  }
};
