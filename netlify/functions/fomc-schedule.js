// netlify/functions/fomc-schedule.js
// Scrape the Fed's "Meeting calendars and information" page and emit decision-day drops
// ONLY if the decision date is within the next WINDOW_DAYS (default 14) from today (local).
// Output: { ok: true, events: [{ title, date:"YYYY-MM-DD", time:"HH:MM" }, ...] }  or events: []

exports.handler = async () => {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  };

  try {
    const WINDOW_DAYS = 14; // <— adjust if you want a bigger/smaller window

    const url = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error("fed page " + res.status);
    const html = await res.text();

    // --- helpers
    const MONTH =
      "(January|February|March|April|May|June|July|August|September|October|November|December)";
    const DASH = "(?:–|—|-|&ndash;|&mdash;)";
    const GAP = "[\\s\\S]{0,80}"; // tolerate HTML/tags between tokens

    // Same-month ranges with tags: e.g., "September" ... "16–17"
    const RX_RANGE_SAME = new RegExp(`${MONTH}\\.?${GAP}(\\d{1,2})${GAP}${DASH}${GAP}(\\d{1,2})`, "gi");
    // Cross-month ranges: e.g., "January 31 – February 1"
    const RX_RANGE_XMON = new RegExp(`${MONTH}${GAP}(\\d{1,2})${GAP}${DASH}${GAP}${MONTH}${GAP}(\\d{1,2})`, "gi");

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

    // --- only parse "20xx FOMC Meetings" sections (skip "Last Update", "Minutes Released", etc.)
    const secRe = /(\d{4})\s*FOMC Meetings([\s\S]*?)(?=\d{4}\s*FOMC Meetings|Back to Top|<\/footer>|$)/gi;
    const sections = [];
    for (let m; (m = secRe.exec(html)); ) {
      sections.push({ year: Number(m[1]), body: m[2] });
    }
    if (!sections.length) throw new Error("no FOMC Meetings sections found");

    // keep current + next year sections
    const today = new Date();
    const curY = today.getFullYear();
    const target = sections.filter(s => s.year === curY || s.year === curY + 1);
    if (!target.length) throw new Error("no sections for current/next year");

    // --- extract decision-day candidates (later day of each meeting)
    const candidates = [];
    for (const sec of target) {
      const y = sec.year;
      const body = sec.body;

      // SAME-MONTH ranges → keep later day
      for (let m; (m = RX_RANGE_SAME.exec(body)); ) {
        const monthName = m[1];
        const d2 = m[3]; // later day
        const idx = m.index ?? 0;
        const slice = body.slice(Math.max(0, idx - 60), idx + 120);
        if (/minutes|released|last\s+update/i.test(slice)) continue; // ignore non-meeting rows
        candidates.push({ iso: toISO(y, monthName, d2), year: y });
      }

      // CROSS-MONTH ranges → keep second month/day
      for (let m; (m = RX_RANGE_XMON.exec(body)); ) {
        const monthName2 = m[4];
        const d2 = m[5];
        const idx = m.index ?? 0;
        const slice = body.slice(Math.max(0, idx - 60), idx + 140);
        if (/minutes|released|last\s+update/i.test(slice)) continue;
        candidates.push({ iso: toISO(y, monthName2, d2), year: y });
      }
    }

    if (!candidates.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, events: [] }) };
    }

    // de-dup + sort
    const seen = new Set();
    const uniq = candidates.filter(c => {
      if (seen.has(c.iso)) return false;
      seen.add(c.iso);
      return true;
    }).sort((a, b) => a.iso.localeCompare(b.iso));

    // --- restrict to next WINDOW_DAYS from today (local)
    const start = new Date(curY, today.getMonth(), today.getDate()).getTime(); // today 00:00 local
    const end = start + WINDOW_DAYS * 86_400_000; // exclusive upper bound
    const inWindow = uniq.filter(c => {
      const t = new Date(c.iso + "T00:00:00").getTime();
      return t >= start && t < end;
    });

    if (!inWindow.length) {
      // Nothing within the window → return empty list
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, events: [] }) };
    }

    // choose the earliest within the window
    const chosen = inWindow[0].iso;

    // build decision-day drops
    const monthNum = parseInt(chosen.slice(5, 7), 10); // 1..12
    const sepMonths = new Set([3, 6, 9, 12]); // Mar/Jun/Sep/Dec → projections
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
