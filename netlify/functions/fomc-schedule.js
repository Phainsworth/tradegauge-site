// netlify/functions/fomc-schedule.js
// Free: scrape the Fed's FOMC calendars page and emit the next decision-day drops.
// We only parse inside the "20xx FOMC Meetings" sections and only accept range-style dates.
// Output: { ok: true, events: [{ title, date:"YYYY-MM-DD", time:"HH:MM" }, ...] }

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

    // ---- Helpers
    const MONTH =
      "(January|February|March|April|May|June|July|August|September|October|November|December)";
    const DASH = "(?:–|—|-|&ndash;|&mdash;)";
    // Example formats inside the Meetings sections:
    //  "September. 16–17" or "September 16–17"  (same-month)
    //  "January 31–February 1"                  (cross-month, rare)
    const RX_RANGE_SAME = new RegExp(`${MONTH}\\.?\\s+(\\d{1,2})\\s*${DASH}\\s*(\\d{1,2})`, "gi");
    const RX_RANGE_XMON = new RegExp(`${MONTH}\\s+(\\d{1,2})\\s*${DASH}\\s*${MONTH}\\s+(\\d{1,2})`, "gi");

    const monthIdx = {
      January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
      July: 6, August: 7, September: 8, October: 9, November: 10, December: 11
    };
    const toISO = (y, mName, d) => {
      const dt = new Date(Number(y), monthIdx[mName], Number(d));
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    // ---- Pull the “20xx FOMC Meetings” sections (avoid Last Update / Minutes dates)
    const secRe = /(\d{4})\s*FOMC Meetings([\s\S]*?)(?=\d{4}\s*FOMC Meetings|Back to Top|<\/footer>|$)/gi;
    const sections = [];
    for (let m; (m = secRe.exec(html)); ) {
      sections.push({ year: Number(m[1]), body: m[2] });
    }
    if (!sections.length) throw new Error("no FOMC Meetings sections found");

    const today = new Date();
    const curY = today.getFullYear();
    // Keep only current year and next year sections
    const targetSections = sections.filter(s => s.year === curY || s.year === curY + 1);
    if (!targetSections.length) throw new Error("no sections for current/next year");

    // ---- Extract decision-day candidates from those sections
    const candidates = [];
    for (const sec of targetSections) {
      const y = sec.year;

      // Same-month ranges → keep the later day
      for (let m; (m = RX_RANGE_SAME.exec(sec.body)); ) {
        const mName = m[1], d2 = m[3];
        // Guard: ignore lines that contain "Minutes" or "Released" to avoid stray dates
        const slice = sec.body.slice(Math.max(0, m.index - 40), m.index + 80);
        if (/minutes|released/i.test(slice)) continue;
        candidates.push({ iso: toISO(y, mName, d2), year: y });
      }

      // Cross-month ranges → keep the later (second) month/day, same year
      for (let m; (m = RX_RANGE_XMON.exec(sec.body)); ) {
        const mName2 = m[4], d2 = m[5];
        const slice = sec.body.slice(Math.max(0, m.index - 40), m.index + 80);
        if (/minutes|released/i.test(slice)) continue;
        candidates.push({ iso: toISO(y, mName2, d2), year: y });
      }
    }

    if (!candidates.length) throw new Error("no meeting ranges found in sections");

    // De-dup, sort
    const seen = new Set();
    const uniq = candidates.filter(c => {
      if (seen.has(c.iso)) return false;
      seen.add(c.iso);
      return true;
    }).sort((a, b) => a.iso.localeCompare(b.iso));

    // ---- Pick the first date >= today (local midnight)
    const todayLocal = new Date(curY, today.getMonth(), today.getDate()).getTime();
    let chosen = uniq.find(c => new Date(c.iso + "T00:00:00").getTime() >= todayLocal)?.iso;
    if (!chosen) chosen = uniq[uniq.length - 1].iso; // fallback to most recent in the pool

    // ---- Build events on the decision day
    const monthNum = parseInt(chosen.slice(5, 7), 10); // 1..12
    const sepMonths = new Set([3, 6, 9, 12]); // Mar, Jun, Sep, Dec → SEP "Economic Projections"
    const events = [
      { title: "FOMC Statement",                    date: chosen, time: "14:00" },
      { title: "Federal Funds Rate (Target Range)", date: chosen, time: "14:00" },
      ...(sepMonths.has(monthNum) ? [{ title: "FOMC Economic Projections", date: chosen, time: "14:00" }] : []),
      { title: "FOMC Press Conference",             date: chosen, time: "14:30" },
    ];

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, events }) };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: false, error: String((err && err.message) || err) })
    };
  }
};
