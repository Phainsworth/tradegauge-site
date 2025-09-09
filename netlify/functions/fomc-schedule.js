// netlify/functions/fomc-schedule.js
// Source: https://www.federalreserve.gov/monetarypolicy.htm (Upcoming Dates box)
// Robust parser: match date tokens near "FOMC Meeting", choose later day, return only if within next 14 days.
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
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };
    const abbrToIndex = (abbr) => {
      const key = String(abbr).replace(/\./g, "").slice(0, 3);
      return MONTH_ABBR[key] ?? null;
    };
    const toISO = (year, monthIndex, day) => {
      const dt = new Date(Number(year), Number(monthIndex), Number(day));
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      const dd = String(dt.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };
    function inferYearByMonthRoll(monthIndex) {
      const now = new Date();
      const curY = now.getFullYear();
      const curM = now.getMonth();
      // If the month is far behind current month, assume next year
      return monthIndex < curM - 1 ? curY + 1 : curY;
    }

    // --- isolate the Upcoming Dates box (fallback to whole page if it moves)
    const upMatch = html.match(/Upcoming Dates([\s\S]*?)(<\/aside>|<\/section>|<h2\b|<footer\b)/i);
    const scope = (upMatch && upMatch[0]) || html;

    // --- find all date tokens in scope:
    //   "Sep. 16–17", "Oct. 28-29", or cross-month "Jan. 31–Feb. 1"
    const DASH = "(?:–|—|-|&ndash;|&mdash;)";
    const MONTH = "(Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|May|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Oct\\.?|Nov\\.?|Dec\\.?)";
    const DATE_TOKEN_RE = new RegExp(
      `${MONTH}\\s*(\\d{1,2})(?:\\s*${DASH}\\s*(?:${MONTH}\\s*)?(\\d{1,2}))?`,
      "gi"
    );
    // We’ll walk tokens and grab the text until the next token; if that slice mentions "FOMC Meeting"
    // (but not "Minutes"), we treat that token as the meeting’s date label.
    const tokens = [];
    for (const m of scope.matchAll(DATE_TOKEN_RE)) {
      tokens.push({
        index: m.index ?? 0,
        text: m[0],
        m1: m[1], d1: m[2],
        m2: m[3] || null, d2: m[4] || null
      });
    }

    if (!tokens.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, events: [] }) };
    }

    const meetings = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const nextIdx = i + 1 < tokens.length ? tokens[i + 1].index : scope.length;
      const block = scope.slice(t.index, nextIdx);

      // Must say "FOMC Meeting" (avoid "FOMC Minutes")
      if (!/FOMC\s+Meeting/i.test(block)) continue;
      if (/Minutes/i.test(block)) continue;

      // Decide the later day + month for the decision date
      let monthIdx, day, yearGuess;
      if (t.d2) {
        // range: choose the later day, prefer second month if present
        monthIdx = t.m2 ? abbrToIndex(t.m2) : abbrToIndex(t.m1);
        day = Number(t.d2);
      } else {
        monthIdx = abbrToIndex(t.m1);
        day = Number(t.d1);
      }
      if (monthIdx == null || !Number.isFinite(day)) continue;

      yearGuess = inferYearByMonthRoll(monthIdx);
      const iso = toISO(yearGuess, monthIdx, day);
      meetings.push(iso);
    }

    // De-dup + sort
    const uniq = Array.from(new Set(meetings)).sort();
    if (!uniq.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, events: [] }) };
    }

    // Keep only meetings within next WINDOW_DAYS (local)
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
    const sepMonths = new Set([3, 6, 9, 12]); // Mar/Jun/Sep/Dec → projections/SEP
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
