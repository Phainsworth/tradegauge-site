// netlify/functions/fomc-schedule.js
// Scrape the Fed's "Meeting calendars and information" page and emit the NEXT decision-day drops.
// Free, no API key. Robust against HTML in tables and ignores "Minutes/Released/Last Update" timestamps.
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

    // --- helpers
    const MONTH =
      "(January|February|March|April|May|June|July|August|September|October|November|December)";
    const DASH = "(?:–|—|-|&ndash;|&mdash;)";
    // Allow up to ~80 chars (including tags/newlines) between tokens inside a row/cell
    const GAP = "[\\s\\S]{0,80}";

    // Same-month ranges with tags: e.g., "September" ... "16–17"
    const RX_RANGE_SAME = new RegExp(`${MONTH}${GAP}(\\d{1,2})${GAP}${DASH}${GAP}(\\d{1,2})`, "gi");
    // Cross-month ranges with tags: e.g., "January 31 – February 1"
    const RX_RANGE_XMON = new RegExp(
      `${MONTH}${GAP}(\\d{1,2})${GAP}${DASH}${GAP}${MONTH}${GAP}(\\d{1,2})`,
      "gi"
    );

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

    // --- Grab only the "20xx FOMC Meetings" sections (avoid "Last Update", "Minutes Released", etc.)
    const secRe = /(\d{4})\s*FOMC Meetings([\s\S]*?)(?=\d{4}\s*FOMC Meetings|Back to Top|<\/footer>|$)/gi;
    const sections = [];
    for (let m; (m = secRe.exec(html)); ) {
      sections.push({ year: Number(m[1]), body: m[2] });
    }
    if (!sections.length) throw new Error("no FOMC Meetings sections found");

    // Keep current + next year sections
    const today = new Date();
    const curY = today.getFullYear();
    const target = sections.filter(s => s.year === curY || s.year === curY + 1);
    if (!target.length) throw new Error("no sections for current/next year");

    // --- extract decision-day candidates (later day of each meeting)
    const candidates = [];
    for (const sec of target) {
      const y = sec.year;
      const body = sec.body;

      // SAME-MONTH ranges
      for (let m; (m = RX_RANGE_SAME.exec(body)); ) {
        const monthName = m[1];
        const d2 = m[2] && m[3] ? m[3] : m[2]; // defensive, but m[3] should exist per regex
        const idx = m.index ?? 0;
        const slice = body.slice(Math.max(0, idx - 60), idx + 120);
        // Ignore rows that are clearly minutes/updates
        if (/minutes|released|last\s+update/i.test(slice)) continue;
        // If the month name is followed by a period "January." it still matches due to GAP
        candidates.push({ iso: toISO(y, monthName, d2), year: y });
      }

      // CROSS-MONTH ranges (rare; keep the second month/day)
      for (let m; (m = RX_RANGE_XMON.exec(body)); ) {
        const monthName2 = m[4];
        const d2 = m[5];
        const idx = m.index ?? 0;
        const slice = body.slice(Math.max(0, idx - 60), idx + 140);
        if (/minutes|released|last\s+update/i.test(slice)) continue;
        candidates.push({ iso: toISO(y, monthName2, d2), year: y });
      }
    }

    if (!candidates.length) throw new Error("no meeting ranges found in sections");

    // de-dup + sort
    const seen = new Set();
    const uniq = candidates.filter(c => {
      if (seen.has(c.iso)) return false;
      seen.add(c.iso);
      return true;
    }).sort((a, b) => a.iso.localeCompare(b.iso));

    // pick first date >= today (local midnight)
    const todayLocal = new Date(curY, today.getMonth(), today.getDate()).getTime();
    let chosen = uniq.find(c => new Date(c.iso + "T00:00:00").getTime() >= todayLocal)?.iso;
    if (!chosen) chosen = uniq[uniq.length - 1].iso;

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
