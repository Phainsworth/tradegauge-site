// netlify/functions/fomc-schedule.js
// Source: https://www.federalreserve.gov/monetarypolicy.htm (Upcoming Dates box)
// Goal: Emit FOMC decision-day events ONLY if the date is within the next 14 days (local).
// Output: { ok: true, events: [{ title, date:"YYYY-MM-DD", time:"HH:MM" }, ...] }  or { ok:true, events: [] }

exports.handler = async () => {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  };

  try {
    const WINDOW_DAYS = 14;

    const url = "https://www.federalreserve.gov/monetarypolicy.htm";
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error("fed page " + res.status);
    const html = await res.text();

    // --- helpers
    const MONTH_ABBR = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const dash = "(?:–|—|-|&ndash;|&mdash;)";
    // Same-month like "Sep. 16-17"
    const RX_RANGE_SAME = new RegExp(
      "(Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|May|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Oct\\.?|Nov\\.?|Dec\\.?)\\s*(\\d{1,2})\\s*" +
      dash +
      "\\s*(\\d{1,2})",
      "i"
    );
    // Cross-month like "Jan. 31–Feb. 1" (rare)
    const RX_RANGE_XMON = new RegExp(
      "(Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|May|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Oct\\.?|Nov\\.?|Dec\\.?)\\s*(\\d{1,2})\\s*" +
      dash +
      "\\s*(Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|May|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Oct\\.?|Nov\\.?|Dec\\.?)\\s*(\\d{1,2})",
      "i"
    );

    const toISO = (year, monthIndex, day) => {
      const dt = new Date(year, monthIndex, day);
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };
    const abbrToIndex = (abbr) => {
      const key = String(abbr).replace(/\./g, "").slice(0, 3);
      return MONTH_ABBR[key] ?? null;
    };

    // --- isolate the "Upcoming Dates" box (loose, but safe)
    const upRe = /Upcoming Dates([\s\S]*?)(<\/aside>|<\/div>|<\/section>)/i;
    const upMatch = html.match(upRe);
    if (!upMatch) {
      // Fallback: scan the whole page near "FOMC Meeting"
      // (keeps function robust if the container changes)
    }
    const scope = (upMatch && upMatch[0]) || html;

    // Find each "FOMC Meeting" occurrence and look backward for the date label like "Sep. 16-17"
    const meetings = [];
    for (const m of scope.matchAll(/FOMC\s+Meeting/gi)) {
      const i = m.index ?? 0;
      // Look back ~120 chars to catch the leading date text
      const win = scope.slice(Math.max(0, i - 160), i);

      // Prefer cross-month, else same-month
      let iso = null;
      let mmIdx, day2, year;

      const x = win.match(RX_RANGE_XMON);
      if (x) {
        const m2 = abbrToIndex(x[3]);
        const d2 = Number(x[4]);
        // Year is usually printed elsewhere; infer from context using nearest year on page or current/next year
        // We'll infer by selecting the first year token after this block, else use current/next based on month wrap
        const yGuess = inferYearFromContext(scope, i) || inferYearByMonthRoll(m2);
        mmIdx = m2; day2 = d2; year = yGuess;
        iso = toISO(year, mmIdx, day2);
      } else {
        const s = win.match(RX_RANGE_SAME);
        if (s) {
          const m1 = abbrToIndex(s[1]);
          const d2s = Number(s[3]);
          const yGuess = inferYearFromContext(scope, i) || inferYearByMonthRoll(m1);
          mmIdx = m1; day2 = d2s; year = yGuess;
          iso = toISO(year, mmIdx, day2);
        }
      }

      if (iso) meetings.push(iso);
    }

    // If nothing found, bail gracefully
    if (!meetings.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, events: [] }) };
    }

    // De-dup + sort
    const uniq = Array.from(new Set(meetings)).sort();

    // Window filter: next 14 days (local)
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); // local midnight
    const end = start + WINDOW_DAYS * 86_400_000;
    const inWindow = uniq.filter(iso => {
      const t = new Date(iso + "T00:00:00").getTime();
      return t >= start && t < end;
    });

    if (!inWindow.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, events: [] }) };
    }

    const chosen = inWindow[0];
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

// --- helpers that need function scope (after handler for clarity)

// Try to infer a year near a position in the HTML (e.g., "2025")
function inferYearFromContext(html, pos) {
  const window = html.slice(pos, pos + 400);
  const m = window.match(/20\d{2}/);
  return m ? Number(m[0]) : null;
}

// If we couldn't read a year token, guess current or next year by month roll
function inferYearByMonthRoll(monthIndex) {
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth();
  // If the month is earlier than current month by more than 1, assume next year; else current.
  const delta = monthIndex - curM;
  return delta < -1 ? curY + 1 : curY;
}
