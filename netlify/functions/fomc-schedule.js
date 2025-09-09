// netlify/functions/fomc-schedule.js
// Free: scrape the Fed's official FOMC calendars page and emit decision-day drops.
// Output: { ok: true, events: [{ title, date: "YYYY-MM-DD", time: "HH:MM" }, ...] }

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

    // --- Regexes to catch both "Sep 16–17, 2025" and "Jan 31–Feb 1, 2026" (cross-month), plus single-day
    const MONTH =
      "(January|February|March|April|May|June|July|August|September|October|November|December)";
    const DASH = "(?:–|-|—|&ndash;|&mdash;)";
    // Range inside same month: "September 16–17, 2025"
    const RX_RANGE_SAME = new RegExp(`${MONTH}\\s+(\\d{1,2})\\s*${DASH}\\s*(\\d{1,2}),\\s*(\\d{4})`, "g");
    // Range across months: "January 31–February 1, 2026"
    const RX_RANGE_XMON = new RegExp(`${MONTH}\\s+(\\d{1,2})\\s*${DASH}\\s*${MONTH}\\s+(\\d{1,2}),\\s*(\\d{4})`, "g");
    // Single-day: "January 30, 2026"
    const RX_SINGLE = new RegExp(`${MONTH}\\s+(\\d{1,2}),\\s*(\\d{4})`, "g");

    const monthIdx = {
      January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
      July: 6, August: 7, September: 8, October: 9, November: 10, December: 11
    };

    const toISO = (year, mName, day) => {
      const dt = new Date(Number(year), monthIdx[mName], Number(day));
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };

    // --- Collect decision-day candidates (always the LATER day of the meeting)
    const candidates = [];

    // Same-month ranges → keep the second (later) day
    for (const m of html.matchAll(RX_RANGE_SAME)) {
      const mName = m[1], d2 = m[3], y = m[4];
      candidates.push({ iso: toISO(y, mName, d2), year: Number(y) });
    }
    // Cross-month ranges → keep the second (later) day (second month/day)
    for (const m of html.matchAll(RX_RANGE_XMON)) {
      const mName2 = m[4], d2 = m[5], y = m[6];
      candidates.push({ iso: toISO(y, mName2, d2), year: Number(y) });
    }
    // Single-day entries (rare) → keep that day
    for (const m of html.matchAll(RX_SINGLE)) {
      const mName = m[1], d = m[2], y = m[3];
      candidates.push({ iso: toISO(y, mName, d), year: Number(y) });
    }

    if (!candidates.length) throw new Error("no meeting dates found");

    // De-dup in case the page structure causes duplicates
    const seen = new Set();
    const uniq = candidates.filter(c => {
      const key = `${c.iso}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // --- Keep only current year and next year to avoid far-future entries
    const today = new Date();
    const curY = today.getFullYear();
    const pool = uniq.filter(c => c.year === curY || c.year === curY + 1);
    if (!pool.length) throw new Error("no current/next-year meetings found");

    // --- Sort ascending and choose the first date >= today (local midnight comparison)
    pool.sort((a, b) => a.iso.localeCompare(b.iso));
    const todayLocalMidnight = new Date(curY, today.getMonth(), today.getDate()).getTime();

    let chosen = pool.find(c => new Date(c.iso + "T00:00:00").getTime() >= todayLocalMidnight)?.iso;
    // Fallback: if all remaining dates are in the past, keep the most recent one
    if (!chosen) chosen = pool[pool.length - 1].iso;

    // --- Build events for the decision day
    const monthNum = parseInt(chosen.slice(5, 7), 10); // 1..12
    const sepMonths = new Set([3, 6, 9, 12]); // Mar, Jun, Sep, Dec → SEP "Economic Projections"

    const events = [
      { title: "FOMC Statement",                         date: chosen, time: "14:00" },
      { title: "Federal Funds Rate (Target Range)",      date: chosen, time: "14:00" },
      ...(sepMonths.has(monthNum) ? [{ title: "FOMC Economic Projections", date: chosen, time: "14:00" }] : []),
      { title: "FOMC Press Conference",                  date: chosen, time: "14:30" },
    ];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, events })
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: false, error: String((err && err.message) || err) })
    };
  }
};

