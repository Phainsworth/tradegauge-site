import React, { useEffect, useMemo, useRef, useState } from "react";
/**
 * TradeGauge App — client-only prototype
 * - Vite env: VITE_OPENAI_KEY, VITE_FINNHUB_KEY, VITE_POLYGON_KEY, (optional) VITE_MACRO_JSON
 *
 * This build:
 * - FIX: Avoids black screen by lazy-loading OpenAI SDK (no top-level import).
 * - Ticker search fix (exact+fuzzy, race-proof, controlled input).
 * - "Why this score" shows *drivers* (not definitions); score supports decimals.
 * - Powell event shown without "(Manual override)".
 */
/* =========================
   Main App (wrapped below)
   ========================= */
function TradeGaugeApp() {
const addDebug = React.useCallback((_msg?: string, _err?: any) => {}, []);
  // -----------------------------
  // FORM + LIVE DATA STATE
  // -----------------------------
const [newsCount, setNewsCount] = useState(3);
const [keyOpen, setKeyOpen] = useState(false);
const [form, setForm] = useState({
  ticker: "",
  type: "",     // "CALL" | "PUT"
  strike: "",
  expiry: "",   // YYYY-MM-DD
  pricePaid: "",
  spot: "",
  open: "",     // <-- NEW: today's open for % change
});
  const [submitted, setSubmitted] = useState(false);
  // --- 3-route advice for "What I'd do if I were you" ---
type RouteChoice = {
  label: string;           // e.g., "Aggressive Approach"
  action: string;          // e.g., "Trim 25%", "Exit", "Hold with a tight stop"
  rationale: string;       // one-liner reason
  guardrail: string | null; // optional one-liner constraint
};
type RoutesOut = {
  routes: {
    aggressive: RouteChoice;
    middle: RouteChoice;
    conservative: RouteChoice;
  };
  pick: {
    route: "aggressive" | "middle" | "conservative";
    reason: string;
    confidence: number;    // 0–100
  };
};

const [routes, setRoutes] = useState<RoutesOut | null>(null);
   type PlanOut = { likes: string[]; watchouts: string[]; plan: string };
const [plan, setPlan] = useState<PlanOut | null>(null);
  // Chain UI
  const [expirations, setExpirations] = useState<string[]>([]);
  const [strikes, setStrikes] = useState<number[]>([]);
   const [allStrikes, setAllStrikes] = useState<number[]>([]);
const [showAllStrikes, setShowAllStrikes] = useState(false);
  const strikeTouchedRef = useRef(false);
  const [loadingExp, setLoadingExp] = useState(false);
  const [loadingStrikes, setLoadingStrikes] = useState(false);
// Strike filtering (view)
// Show exactly 15 strikes below and 15 above the closest-to-spot strike (≈31 total)
const STRIKES_EACH_SIDE = 30;

  // AI insights
  type Insights = {
    score: number; // 0..10 decimal
    headline?: string;
    narrative?: string;
    advice: string[];
    explainers: string[]; // drivers
    risks?: string[];
    watchlist?: string[];
    strategy_notes?: string[];
    confidence?: number;
  };
   const USE_PRICE_GUIDANCE = true; // true = allow exact $ limits; false = generic-only
  const [insights, setInsights] = useState<Insights>({
    score: 0,
    advice: [],
    explainers: [],
  });
  const [llmStatus, setLlmStatus] = useState<string>("");
  const [isGenLoading, setIsGenLoading] = useState(false);


  // Loading overlay (3 jokes, 2s each)
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayStep, setOverlayStep] = useState(0);
  const [overlayPlaylist, setOverlayPlaylist] = useState<string[]>([]);
  // Fast color+number cycle for loading screen
const [spinnerHue, setSpinnerHue] = useState(0);
const [spinnerScore, setSpinnerScore] = useState(0);
// Show the true score in the background once we have it
const [showRealBg, setShowRealBg] = useState(false);

// Map 0→10 score to a risk hue (green→red). Tweak endpoints if you like.
const hueForScore = (s: number) => {
  const clamped = Math.max(0, Math.min(10, s));
  return Math.round(120 - (clamped / 10) * 120); // 120=green, 0=red
};

useEffect(() => {
  // flip on when overlay is open AND we actually have a real score
  const real = Number((insights as any)?.score);
  setShowRealBg(overlayOpen && Number.isFinite(real));
}, [overlayOpen, insights]);
useEffect(() => {
  if (!overlayOpen) return;

  let rafId: number;
  const tick = () => {
    const t = performance.now();

    // Hue cycles 0..360 quickly
    setSpinnerHue(Math.floor((t / 12) % 360));

    // Smoothly cycle 0..10 (two sines for wobble)
    const val =
      5 +
      5 * Math.sin(t / 180) +   // slow wave
      0.7 * Math.sin(t / 43);   // fast wobble
    const clamped = Math.max(0, Math.min(10, val));
    setSpinnerScore(Math.round(clamped * 10) / 10);

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}, [overlayOpen]);
// Auto-hide the Key while loading; restore it when loading finishes
const keyWasAutoHidden = useRef(false);
useEffect(() => {
  if (overlayOpen) {
    if (keyOpen) keyWasAutoHidden.current = true; // remember if we hid it
    setKeyOpen(false);
  } else if (keyWasAutoHidden.current) {
    setKeyOpen(true);                  // restore only if we auto-hid it
    keyWasAutoHidden.current = false;
  }
}, [overlayOpen]); // uses keyOpen, setKeyOpen from earlier

  const overlayMsgs = [
    "Gathering required data…",
    "Weighing pros & cons…",
    "Reading Elon's mind…",
    "Looking through Jerome Powell's window…",
    "Putting the fries in the bag…",
    "Mopping the floors…",
    "Checking Trump tweets…",
    "Pickle.....?",
    "Is this thing on?",
  ];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


  useEffect(() => {
    if (!overlayOpen) return;
    const pool = [...overlayMsgs];
    const chosen: string[] = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      chosen.push(pool.splice(idx, 1)[0]);
    }
    setOverlayPlaylist(chosen);
    setOverlayStep(0);
    const t1 = window.setTimeout(() => setOverlayStep(1), 2000);
    const t2 = window.setTimeout(() => setOverlayStep(2), 4000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [overlayOpen]);


  // Spot (Finnhub)
  const [spotLoading, setSpotLoading] = useState(false);
  const spotCooldownUntil = useRef(0);
// Live option quote (bid/ask/mark)
const [quote, setQuote] = useState<{bid:string; ask:string; last:string; mark:string; src:string}>({
  bid: "—", ask: "—", last: "—", mark: "—", src: ""
});

  // Polygon Greeks/IV snapshot
  const [greeks, setGreeks] = useState({
    delta: "—",
    gamma: "—",
    theta: "—",
    vega: "—",
    iv: "—",
    openInterest: "—",
  });
  const [polyStatus, setPolyStatus] = useState<string>("—");
  const [matchedContract, setMatchedContract] = useState<string>("");


  // News & Macro & Earnings
  type Headline = { title: string; source?: string; url?: string; ts?: number };
  type EconEvent = { title: string; date: string; time?: string };
  type Earnings = { date: string; when?: string; confirmed?: boolean };
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [econEvents, setEconEvents] = useState<EconEvent[]>([]);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
// --- Patch notes (home screen only) ---
const APP_VERSION = "v1.1";
const PATCH_NOTES: Array<{ date: string; title: string; items: string[] }> = [
  {
    date: "2025-09-05",
    title: "UI",
    items: [
      "Added “Try another contract” button under Inputs.",
      "Hidden during scoring; glassy theme to match UI.",
       "Fixed strikes not loading properly",
    ],
  },
  {
    date: "2025-09-05",
    title: "Results polish",
    items: [
      "Borders on boxes.",
      "Adjusted advice logic",
    ],
  },
];

  // Cache chains per ticker
  const chainCache = useRef<Map<string, any[]>>(new Map());


  // -----------------------------
  // HELPERS
  // -----------------------------
   function median(nums) {
  const a = (nums || []).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  const n = a.length;
  if (!n) return null;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
// --- Normalize "Price Paid" (per-share) from messy user input ---
// Accepts: "28.00", "2800", "$28", ".50", "50c", "50¢", "100", etc.
// Rule of thumb:
// - If there's a decimal already → keep it (two decimals).
// - If user typed cents (ends with c/¢) → divide by 100.
// - If no decimal and you have a live mark: if value > 3× mark → divide by 100.
// - If no mark: any integer ≥ 100 → divide by 100.
function capFirst(s: string) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
async function finnhub(pathAndQuery: string) {
  const res = await fetch(`/.netlify/functions/finnhub-proxy?path=${encodeURIComponent(pathAndQuery)}`);
  if (!res.ok) throw new Error(`finnhub proxy failed: ${res.status}`);
  return res.json();
}
async function poly(pathAndQuery: string) {
  const res = await fetch(`/.netlify/functions/polygon-proxy?path=${encodeURIComponent(pathAndQuery)}`);
  if (!res.ok) throw new Error(`polygon proxy failed: ${res.status}`);
  return res.json();
}
function normalizePaid(raw: any, refMark?: number | null): number | null {
  const txt = (raw ?? "").toString().trim();
  if (!txt) return null;

  // ".50" style
  if (/^\.\d+$/.test(txt)) {
    const f = Number(txt);
    return Number.isFinite(f) && f > 0 ? Math.round(f * 100) / 100 : null;
  }
  // strip $, commas, spaces; capture explicit cents
  let s = txt.replace(/[$,\s]/g, "").toLowerCase();
  let centsFlag = false;
  if (/[c¢]$/.test(s)) {
    s = s.replace(/[c¢]$/, "");
    centsFlag = true;
  }
  if (!s || s === "." || s === "-") return null;

  let n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;

  const hasDot = s.includes(".");
  if (hasDot) {
    return Math.round(n * 100) / 100;
  }

  // No decimal: decide scaling
  if (centsFlag) {
    n = n / 100;
  } else if (Number.isFinite(refMark as any) && (refMark as number) > 0) {
    // If typed value is way bigger than plausible per-share price, treat as cents
    if (n > (refMark as number) * 3) n = n / 100; // 3× is a good, less jumpy threshold
  } else {
    // No mark available: assume integers ≥100 are cents
    if (n >= 100) n = n / 100;
  }

  return Math.round(n * 100) / 100;
}
function getPaidNormalized(raw: any, refMark?: number | null): number | null {
  const n = normalizePaid(raw, refMark);
  return Number.isFinite(n as any) ? (n as number) : null;
}
function parseRoutesJson(s: string): RoutesOut | null {
  if (!s) return null;
  try {
    const j = JSON.parse(s);
    if (
      j && j.routes && j.pick &&
      j.routes.aggressive && j.routes.middle && j.routes.conservative &&
      typeof j.routes.aggressive.action === "string" &&
      typeof j.routes.middle.action === "string" &&
      typeof j.routes.conservative.action === "string" &&
      (j.pick.route === "aggressive" || j.pick.route === "middle" || j.pick.route === "conservative")
    ) {
      return j as RoutesOut;
    }
  } catch {}
  return null;
}
function normalizeRoutes(out: RoutesOut, ctx: { dte: number; bidNow: number | null }): RoutesOut {
  const clone: RoutesOut = JSON.parse(JSON.stringify(out));
  const { dte, bidNow } = ctx;

  const fixTrim = (rc: RouteChoice) => {
    if (!rc?.action) return;
    if (/\btrim\b/i.test(rc.action)) {
      // Ensure conditional phrasing for trim
      const trimLine = rc.action.replace(/\.$/, "");
      rc.action = `If you have more than one contract, ${trimLine}. If this is your only contract, either exit now or keep it as a tiny lotto.`;
      // Nudge guardrail if missing
      if (!rc.guardrail) rc.guardrail = "Keep any lotto tiny and be okay with a full loss.";
    }
  };

  // Enforce semantics for each route
  const A = clone.routes.aggressive;
  const M = clone.routes.middle;
  const C = clone.routes.conservative;

  // 1) Aggressive should rarely be "Exit"
  if (A?.action && /\b(exit|close)\b/i.test(A.action)) {
    const imminent = dte <= 1;                     // ~<=1 day left
    const deadBid = (bidNow ?? 0) <= 0;            // effectively no bid
    if (!imminent && !deadBid) {
      A.action = "Let it ride small";
      A.rationale = A.rationale || "Risk-seeking route: give it a chance, but accept lotto odds.";
      A.guardrail = A.guardrail || "Treat as lotto; keep size tiny.";
    }
  }

  // 2) Always fix trim phrasing across routes
  fixTrim(A);
  fixTrim(M);
  fixTrim(C);

  return clone;
}

// ----- Expiry Scenario Builder (intrinsic at expiry only) -----
// --- POP + utils ---
function normalCdf(x: number) {
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}
function softResetForNewInput() {
  setGreeks({ delta:"—", gamma:"—", theta:"—", vega:"—", iv:"—", openInterest:"—" });
  setPolyStatus("—");
  setMatchedContract("");
  setInsights({ score: 0, advice: [], explainers: [] });
  setLlmStatus("");
  setHeadlines([]);
 // setEconEvents([]);
  setEarnings(null);
}
// Probability of expiring ITM using IV + DTE (risk‑neutral, drift≈0)
function probITM({
  spot,
  strike,
  isCall,
  ivPct,
  dte,
}: {
  spot: number;
  strike: number;
  isCall: boolean;
  ivPct: number | null; // e.g. 42 (%)
  dte: number; // days
}) {
  if (!Number.isFinite(spot) || !Number.isFinite(strike)) return null;
  if (!Number.isFinite(ivPct as any) || (ivPct as any) <= 0 || !Number.isFinite(dte) || dte <= 0)
    return null;

  const sigma = (ivPct as number) / 100;
  const T = Math.max(1e-6, dte / 365);
  const denom = sigma * Math.sqrt(T);
  if (!Number.isFinite(denom) || denom <= 0) return null;

  // Black–Scholes d2 with r≈0
  const d2 = (Math.log(spot / strike) - 0.5 * sigma * sigma * T) / denom;
  const callPOP = normalCdf(d2);
  const putPOP = normalCdf(-d2);
  const p = isCall ? callPOP : putPOP;
  return Math.round(p * 100); // %
}
   // === Reset to starting view ===
function resetToHome() {
  // Return to the input view
  setSubmitted(false);

  // Restore form to its initial blank state
  setForm({
    ticker: "",
    type: "",
    strike: "",
    expiry: "",
    pricePaid: "",
    spot: "",
    open: "",
  });

  // Clear chain UI and routes/results
  setExpirations([]);
  setStrikes([]);
  setRoutes(null);
   setPlan(null);

  // Reset live quote display
  setQuote({ bid: "—", ask: "—", last: "—", mark: "—", src: "" });

  // Reset news count selector to default (3)
  setNewsCount(3);

  // Clear ticker autocomplete UI
  setTickerQuery("");
  setTickerOpen(false);
  setTickerOpts([]);
  setTickerIdx(-1);

  // Hide the left legend if open
  setKeyOpen(false);

  // Clear analysis panels (greeks, headlines, econ, earnings, statuses)
  softResetForNewInput();
  setIsGenLoading(false);
  setLlmStatus("");

  // Scroll to the top
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function chipTone(kind: "warning" | "danger" | "info" | "good") {
  switch (kind) {
    case "danger":
      return "bg-rose-500/15 text-rose-300 border border-rose-500/30";
    case "warning":
      return "bg-amber-500/15 text-amber-300 border border-amber-500/30";
    case "good":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
    default:
      return "bg-neutral-700/20 text-neutral-300 border border-neutral-600/30";
  }
}

function Chip({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`px-2 py-0.5 rounded text-[11px] ${tone}`}>{children}</span>;
}

// --- Save & Share ---
function currentTradeStateToObject(form: any, greeks: any, insights: any, daysToExpiry: number) {
  return {
    ticker: form.ticker,
    type: form.type,
    strike: form.strike,
    expiry: form.expiry,
    pricePaid: form.pricePaid,
    spot: form.spot,
    greeks,
    score: insights?.score ?? null,
    dte: daysToExpiry,
    ts: Date.now(),
  };
}
function buildShareUrl(obj: any) {
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  const u = new URL(window.location.href);
  u.searchParams.set("t", payload);
  return u.toString();
}
function buildExpiryScenarios(params: {
  spot: number;
  strike: number;
  isCall: boolean;
  pricePaid?: number;   // contract price in $ (not cents)
  stepPct?: number;     // e.g., 1 or 2 (default 2)
  rangePct?: number;    // e.g., 20 for -20%..+20% (default 20)
}) {
  const {
    spot, strike, isCall,
    pricePaid = 0,
    stepPct = 2,
    rangePct = 20,
  } = params;

  const rows: {
    pct: number;
    S: number;
    value: number;   // per contract ($)
    pl?: number;
    roi?: number;
  }[] = [];

  const intrinsicAt = (S: number) =>
    Math.max(0, isCall ? S - strike : strike - S) * 100; // per contract

  for (let p = -rangePct; p <= rangePct; p += stepPct) {
    const S = +(spot * (1 + p / 100)).toFixed(2);
    const value = +intrinsicAt(S).toFixed(2);
    const hasPaid = Number.isFinite(pricePaid) && pricePaid > 0;
    const paidCents = hasPaid ? pricePaid * 100 : NaN;
    const pl = hasPaid ? +(value - paidCents).toFixed(2) : undefined;
    const roi = hasPaid && paidCents > 0 ? +(((value - paidCents) / paidCents) * 100).toFixed(0) : undefined;
    rows.push({ pct: p, S, value, pl, roi });
  }
  return rows;
}

  const num = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const isDigits = (s: string) =>
    s.split("").every((ch) => ch >= "0" && ch <= "9");
  const displayMDY = (s: string) => {
    if (s && s.length === 10 && s[4] === "-" && s[7] === "-") {
      const y = s.slice(0, 4);
      const m = s.slice(5, 7);
      const d = s.slice(8, 10);
      return `${Number(m)}/${Number(d)}/${y}`;
    }
    return s;
  };
  const toYMD_UTC = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
   // ---- Danger-window helpers ----
function daysFromNow(isoDate: string): number {
  const today = new Date();
  const atMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const d = new Date(isoDate + "T00:00:00Z").getTime();
  return Math.floor((d - atMidnight) / 86_400_000);
}

function windowFor(kind: string): [number, number] {
  const k = kind.toLowerCase();
  if (k.includes("cpi")) return [-1, +1];
  if (k.includes("ppi")) return [-1, +1];
  if (k.includes("retail")) return [-1, 0];
  if (k.includes("fomc")) return [-2, +2];
  if (k.includes("powell")) return [0, 0];
  if (k.includes("jobs")) return [0, 0];
  if (k.includes("earnings")) return [-2, +1];
  return [0, 0];
}

function buildDangerWindows(
  events: { title: string; date: string }[],
  horizonDays = 14
): { start: number; end: number }[] {
  const raw = events
    .map(ev => {
      const d = daysFromNow(ev.date);
      const [pre, post] = windowFor(ev.title);
      return { start: d + pre, end: d + post };
    })
    .map(w => ({ start: Math.max(0, w.start), end: Math.min(horizonDays, w.end) }))
    .filter(w => w.start <= w.end);

  if (!raw.length) return [];
  raw.sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (!last || w.start > last.end + 1) {
      merged.push({ ...w });
    } else {
      last.end = Math.max(last.end, w.end);
    }
  }
  return merged;
}
  const normalizeExpiry = (v: any): string | null => {
    if (!v && v !== 0) return null;
    if (typeof v === "string") {
      const s = v.trim();
      if (s.length === 10 && s[4] === "-" && s[7] === "-") return s;
      if (s.length === 8 && isDigits(s))
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
      const d = new Date(s);
      if (!isNaN(d.getTime())) return toYMD_UTC(d);
    }
    if (typeof v === "number") {
      const ms = v > 1e12 ? v : v * 1000;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return toYMD_UTC(d);
    }
    return null;
  };
  async function fetchExternalMacroJSON(): Promise<EconEvent[]> {
  try {
    const MACRO_JSON_URL = (import.meta as any).env?.VITE_MACRO_JSON;
    if (!MACRO_JSON_URL) return [];
    const r = await fetch(MACRO_JSON_URL, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const j = await r.json();
    const arr = Array.isArray(j) ? j : Array.isArray(j?.events) ? j.events : [];
    return (arr as any[]).map((x) => {
      const date = (/\d{4}-\d{2}-\d{2}/.exec((x?.date || x?.releaseDate || x?.nextRelease || x?.eventDate || x?.datetime || "").toString())?.[0]) || "";
      const time = (/\b\d{2}:\d{2}\b/.exec((x?.time || x?.releaseTime || x?.datetime || "").toString())?.[0]) || "";
      const title = (x?.title || x?.name || x?.event || "").toString();
      return { title, date, time };
    }).filter(e => e.title && e.date);
     
  } catch {
    return [];
  }
}
  const isFiniteNumber = (v: any) => Number.isFinite(Number(v));
  const round = (n: number, d = 2) =>
    Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
  function riskFromScore(s: number) {
    let bucket = "Moderate";
    let color = "text-yellow-400";
    if (s <= 3) {
      bucket = "Low";
      color = "text-green-400";
    } else if (s <= 6) {
      bucket = "Moderate";
      color = "text-yellow-400";
    } else if (s <= 8) {
      bucket = "High";
      color = "text-orange-400";
    } else {
      bucket = "Very High";
      color = "text-red-400";
    }
    return { bucket, color };
  }


  // Derived features passed to AI and Quick Stats
  function buildDerived({
    spot,
    strike,
    optionType,
    pricePaid,
    greeks,
    daysToExpiry,
  }: {
    spot: number | null;
    strike: number;
    optionType: "CALL" | "PUT";
    pricePaid: number | null;
    greeks: {
      delta: number | null;
      gamma: number | null;
      theta: number | null;
      vega: number | null;
      iv: number | null;
      openInterest: number | null;
    };
    daysToExpiry: number;
  }) {
    const isCall = optionType === "CALL";
    const s = Number.isFinite(spot as number) ? (spot as number) : NaN;
    const k = strike;
    const paid = Number.isFinite(pricePaid as number) ? (pricePaid as number) : NaN;


    const moneyness = Number.isFinite(s) ? (isCall ? s / k : k / s) : NaN;
    const distancePct = Number.isFinite(s) ? ((isCall ? k - s : s - k) / s) : NaN;
    const thetaPer$100 = Number.isFinite(greeks.theta as number)
      ? (greeks.theta as number) * 100
      : null;
    const vegaPerVolPt$100 = Number.isFinite(greeks.vega as number)
      ? (greeks.vega as number) * 100
      : null;
    const theoreticalBreakeven = Number.isFinite(paid)
      ? isCall
        ? k + paid
        : k - paid
      : null;
    const breakevenGapPct =
      Number.isFinite(s) && Number.isFinite(theoreticalBreakeven as number)
        ? (((theoreticalBreakeven as number) - s) / s) * 100
        : null;


    const intrinsic = Number.isFinite(s)
      ? isCall
        ? Math.max(0, s - k)
        : Math.max(0, k - s)
      : null;
    const extrinsic =
      Number.isFinite(paid) && Number.isFinite(intrinsic as number)
        ? Math.max(0, (paid as number) - (intrinsic as number))
        : null;
    const extrinsicPct =
      Number.isFinite(extrinsic as number) && Number.isFinite(paid)
        ? ((extrinsic as number) / (paid as number)) * 100
        : null;


    return {
      dte: daysToExpiry,
      moneyness,
      distance_otm_pct: Number.isFinite(distancePct) ? Number(distancePct * 100) : null,
      theta_per_100: thetaPer$100,
      vega_per_volpt_per_100: vegaPerVolPt$100,
      breakeven: theoreticalBreakeven,
      breakeven_gap_pct: breakevenGapPct,
      extrinsic_pct: extrinsicPct,
    };
  }


  // -----------------------------
  // Score drivers + nudge (for decimals)
  // -----------------------------
  function numberOrNull(v: any) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }


  function buildScoreDrivers(args: {
    dte: number;
    ivPct: number | null;
    distance_otm_pct: number | null;
    delta: number | null;
    theta: number | null;
    vega: number | null;
    oi: number | null;
    breakeven_gap_pct: number | null;
    earningsSoonTxt: string;
    macroSoon: string[];
  }): string[] {
    const drivers: string[] = [];
    if (args.earningsSoonTxt !== "none")
      drivers.push(`Earnings ${args.earningsSoonTxt} → event risk/IV swing`);
    if (args.macroSoon.length)
      drivers.push(`${args.macroSoon[0]} → macro volatility risk`);
    if (args.dte <= 10) drivers.push(`Short DTE (${args.dte}) → faster theta decay`);
    if (args.ivPct !== null) {
      if (args.ivPct >= 60)
        drivers.push(`Elevated IV (${args.ivPct.toFixed(0)}%) → IV crush risk`);
      else if (args.ivPct <= 25)
        drivers.push(`Low IV (${args.ivPct.toFixed(0)}%) → cheaper premium, move matters`);
    }
    if (args.distance_otm_pct !== null) {
      const d = Math.abs(args.distance_otm_pct);
      if (d >= 15) drivers.push(`Deep OTM (~${d.toFixed(0)}%) → low hit probability`);
      else if (d <= 2) drivers.push(`Near ATM (~${d.toFixed(1)}%) → higher gamma`);
    }
    if (args.delta !== null) {
      const a = Math.abs(args.delta);
      if (a >= 0.7)
        drivers.push(
          `High delta (${args.delta.toFixed(2)}) → stock-like; assignment risk if ITM near expiry`
        );
      else if (a <= 0.25)
        drivers.push(`Low delta (${args.delta.toFixed(2)}) → needs outsized move`);
    }
    if (args.theta !== null && Math.abs(args.theta) >= 0.1)
      drivers.push(`Large theta (~$${Math.round(Math.abs(args.theta) * 100)}/day)`);
    if (args.vega !== null && Math.abs(args.vega) >= 0.15)
      drivers.push(`High vega (${args.vega.toFixed(2)}) → sensitive to IV`);
    if (args.oi !== null && args.oi < 500)
      drivers.push(`Thin liquidity (OI ${args.oi}) → wider spreads`);
    if (args.breakeven_gap_pct !== null) {
      const g = args.breakeven_gap_pct;
      if (g > 10) drivers.push(`Breakeven far (+${g.toFixed(1)}%)`);
      else if (g < -5) drivers.push(`Breakeven inside (-${Math.abs(g).toFixed(1)}%)`);
    }
    return drivers.slice(0, 6);
  }


  function computeScoreNudge(args: {
  dte: number;
  ivPct: number | null;
  distance_otm_pct: number | null;
  oi: number | null;
  breakeven_gap_pct: number | null;
}): number {
  let n = 0;

  // normalize nullable inputs to numbers so TS stops complaining
  const dte = args.dte; // already a number
  const iv  = args.ivPct ?? NaN;
  const dist = args.distance_otm_pct ?? NaN;    // signed in, we’ll abs()
  const oi   = args.oi ?? NaN;
  const g    = args.breakeven_gap_pct ?? NaN;

  // Time left (smaller penalty; small credit for long time)
  if (Number.isFinite(dte)) {
    if (dte <= 5) n += 0.25;
    else if (dte <= 10) n += 0.10;
    else if (dte >= 90) n -= 0.10;
  }

  // IV (reward truly low IV more; soften high IV penalty)
  if (Number.isFinite(iv)) {
    if (iv <= 18) n -= 0.30;
    else if (iv <= 25) n -= 0.15;
    else if (iv >= 60) n += 0.15;
  }

  // Distance from ATM (use the signed % you already compute upstream)
  if (Number.isFinite(dist)) {
    const d = Math.abs(dist);
    if (d <= 1.5) n -= 0.20;
    else if (d <= 3) n -= 0.10;
    else if (d >= 25) n += 0.30;
    else if (d >= 15) n += 0.20;
  }

  // Liquidity (reward very high OI; still penalize thin chains)
  if (Number.isFinite(oi)) {
    if (oi < 100) n += 0.30;
    else if (oi < 500) n += 0.15;
    else if (oi >= 10000) n -= 0.25;
    else if (oi >= 5000) n -= 0.15;
  }

  // Breakeven gap (% from spot to breakeven)
  if (Number.isFinite(g)) {
    if (g > 10) n += 0.25;
    else if (g > 5) n += 0.10;
    else if (g < -5) n -= 0.25;
    else if (Math.abs(g) <= 2) n -= 0.10;
  }

  // Clamp overall nudge
  if (n > 0.5) n = 0.5;
  if (n < -0.5) n = -0.5;
  return n;
}
function computeRuleRiskScore(args: {
  dte: number;                     // days to expiry
  ivPct: number | null;            // e.g., 42 (%)
  distance_otm_pct: number | null; // signed (we'll abs it)
  oi: number | null;               // open interest
  breakeven_gap_pct: number | null;// % from spot to breakeven (+ = needs move)
  earningsSoonTxt?: string;        // "today", "in 3 day(s)", "none"
  macroSoon?: string[];            // events in next 7 days
}): number {
  let s = 2.0; // start "safe-ish"

  // DTE (time risk)
  const d = args.dte;
  if (d <= 1) s += 7;
  else if (d <= 2) s += 6;
  else if (d <= 5) s += 4;
  else if (d <= 10) s += 2.5;
  else if (d >= 180) s -= 0.8;
  else if (d >= 90)  s -= 0.4;

  // IV level (vol premium & crush risk)
  const iv = args.ivPct;
  if (iv != null) {
    if (iv >= 80) s += 1.5;
    else if (iv >= 60) s += 1.0;
    else if (iv <= 25) s -= 0.4;
  }

  // Distance from ATM (probability/gamma)
  const dist = Number.isFinite(args.distance_otm_pct as any) ? Math.abs(args.distance_otm_pct as number) : null;
  if (dist != null) {
    if (dist >= 20) s += 1.5;
    else if (dist >= 10) s += 1.0;
    else if (dist <= 2)  s += 0.3; // ATM: gamma/whipsaw risk
  }

  // Liquidity
  const oi = args.oi;
  if (oi != null) {
    if (oi < 100)  s += 1.0;
    else if (oi < 500) s += 0.5;
    else if (oi > 5000) s -= 0.2;
  }

  // Breakeven distance (needs big move?)
  const g = args.breakeven_gap_pct;
  if (g != null) {
    if (g > 15) s += 1.5;
    else if (g > 10) s += 1.0;
    else if (g < -5) s -= 0.5; // already inside breakeven → safer
  }

  // Event risk (earnings/macro upcoming)
  if ((args.earningsSoonTxt || "").startsWith("today")) s += 1.5;
  else if ((args.earningsSoonTxt || "").includes("in ") && (args.earningsSoonTxt || "").includes("day")) s += 0.8;
  if (args.macroSoon && args.macroSoon.length) s += 0.5;

  return Math.max(0, Math.min(10, Number(s.toFixed(1))));
}

  // -----------------------------
  // AI (lazy-load OpenAI SDK)
  // -----------------------------
  type NumericGreeks = {
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
    iv: number | null;
    openInterest: number | null;
  };
type NumericQuote = { bid: number | null; ask: number | null; last: number | null; mark: number | null };

type AnalyzeOpts = {
  greeksOverride?: NumericGreeks;
  contractOverride?: string;
  quoteOverride?: NumericQuote; // <— NEW
};

  function sanitizeNarrative(s: string | undefined) {
    if (!s) return s;
    const badPhrases = [
      /we\s+(lack|don['’]t have)/i,
      /\bunknown\b/i,
      /not\s+provided/i,
      /can('?|no) ?t\s+assess/i,
      /hard\s+to\s+gauge/i,
      /missing\s+(data|numbers|metrics)/i,
      /\bdelta\b.*\bis\b/i,
      /\btheta\b.*\bis\b/i,
      /\bvega\b.*\bis\b/i,
    ];
    let out = s;
    for (const re of badPhrases) {
      out = out
        .split(/(?<=[.!?])\s+/)
        .filter((sent) => !re.test(sent))
        .join(" ");
    }
    return out.trim();
  }


function makeBuddySystemPrompt() {
  return `
You are a seasoned options friend who talks like a human—smart, concise, a little witty.
Tone: casual, confident, empathetic. Use 0–2 emojis total (only if they genuinely help).
Voice: write like a cool trading buddy, not a professor; avoid corporate speak.

Do:
- Pick the 1–2 biggest drivers (e.g., extreme IV, heavy theta, deep OTM, near-ITM squeeze).
- Describe how the contract is likely to behave from here (decay pace, IV crush risk, delta sensitivity, lotto odds).
- If the user is up big, nod to it; if they’re down, be kind but direct.

Avoid:
- Listing every stat, generic platitudes, or calls to action. This section is perspective & vibes only.

STRICT JSON OUTPUT:
{
  "score": number,
  "headline": "short punchy one-liner (may include 1 emoji)",
  "narrative": "3–5 short sentences, conversational and specific to THIS contract.",
  "advice": string[],
  "explainers": string[],
  "risks": string[],
  "watchlist": string[],
  "strategy_notes": string[],
  "confidence": number
}
Output raw JSON only—no markdown, no backticks.`.trim();
}
function makeRoutesSystemPrompt() {
  return `
You are a blunt-but-supportive trading buddy. Produce THREE routes for THIS exact contract, then one pick ("If it was me").

Tone & style:
- Conversational, crisp, a little swagger. Use active voice. 0–2 emojis TOTAL across the whole output.
- Keep each route tight: label, action, 1–2 sentences of rationale, and ONE guardrail.

Rules:
- Allowed actions only: Exit/Close, Take profits/Trim, Hold with conditions, Let it ride small, Wait for pullback, Probe small at limit.
- If recommending “Trim”, ALWAYS use conditional phrasing:
  - “If you have more than one contract, trim X%.”
  - “If this is your only contract, either exit OR keep a tiny lotto (say which).”
- Aggressive should rarely be “Exit” unless DTE is almost zero AND there’s no catalyst.
- ONE guardrail per route (tight stop, invalidation level, time stop, or “skip if spread > X%”).
- Respect liquidity: if spread is wide or OI is thin, say so and prefer ranges over exact prices.

Price guidance mode (the user prompt will include one of these):
- "price-specific": include a single concrete limit or tight zone when reasonable (e.g., "$5.30" or "$5.10–$5.30").
- "generic-only": DO NOT include dollar amounts; use conditions/levels instead (e.g., "on pullback to prior support").

STRICT JSON OUTPUT:
{
  "routes": {
    "aggressive": {"label": "Aggressive Approach", "action": "...", "rationale": "...", "guardrail": "..." | null},
    "middle": {"label": "Middle of the Road", "action": "...", "rationale": "...", "guardrail": "..." | null},
    "conservative": {"label": "Conservative Approach", "action": "...", "rationale": "...", "guardrail": "..." | null}
  },
  "pick": {"route": "aggressive|middle|conservative", "reason": "short human reason (may include 1 emoji)"}
}
Output raw JSON only—no markdown, no backticks.`.trim();
}
function makePlanSystemPrompt() {
  return `
You are a seasoned options friend. Middle-of-the-road risk stance by default.
Tone: casual, concise, human; 0–2 emojis total only if they help. No hard $ prices.

Return STRICT JSON ONLY:
{
  "likes": ["short bullet", "..."],
  "watchouts": ["short bullet", "..."],
  "plan": "one clear middle-risk plan: when to act (conditions), why, and guardrails (invalidation, spread %, time stop). No exact dollar amounts."
}
Output raw JSON only—no markdown.`.trim();
}
function makePlanUserPrompt(args: {
  ticker: string;
  optionType: "CALL" | "PUT";
  strike: number;
  expiry: string;
  dte: number;
  ivPct: number | null;
  pnlPct: number | null;
  distance_otm_pct: number | null;
  spreadWide: boolean | null;
  liquidityOi: number | null;
  earningsDays: number | null;
  macroSoon: string | null;
}) {
  const ivStr = args.ivPct == null ? "—" : `${args.ivPct}%`;
  const pnlStr = args.pnlPct == null ? "—" : `${Math.round(args.pnlPct)}%`;
  const distStr = args.distance_otm_pct == null ? "—" : `${Math.round(args.distance_otm_pct)}%`;
  const spreadStr = args.spreadWide == null ? "unknown" : args.spreadWide ? "wide" : "normal";
  const oiStr = args.liquidityOi == null ? "—" : `${args.liquidityOi}`;
  const earnStr =
    args.earningsDays == null ? "none" :
    args.earningsDays <= 0 ? "today" :
    args.earningsDays <= 7 ? `in ${args.earningsDays} day(s)` :
    `in ~${args.earningsDays} day(s)`;
  const macroStr = args.macroSoon ? args.macroSoon : "none";

  return `
Contract: ${args.ticker} ${args.optionType} ${args.strike} exp ${args.expiry}
DTE: ${args.dte}
IV: ${ivStr}
PnL% (if any): ${pnlStr}
Distance OTM%: ${distStr}
Spread: ${spreadStr}
Open Interest: ${oiStr}
Earnings: ${earnStr}
Macro (7d): ${macroStr}

Write PROS / WATCH-OUTS / WHAT I'D DO for THIS contract.
- Middle-of-the-road risk tone (not aggressive, not passive).
- Condition-based only. NO exact dollar amounts.
- Use 0–2 emojis max, only if they truly help.
- Keep bullets short and specific; plan includes invalidation, spread condition, and time stop.

Return STRICT JSON ONLY:
{
  "likes": ["short bullet", "..."],
  "watchouts": ["short bullet", "..."],
  "plan": "one clear middle-risk plan with conditions + guardrails. No hard prices."
}`.trim();
}
   
  function makeBuddyUserPrompt(payload: any) {
    const { ticker, optionType, strike, expiry, spot, greeks, derived, dte, earnings, macro_events } = payload;


// Normalize IV to a percent integer (e.g., 0.68 -> 68, "68%" -> 68)
const ivPct = (() => {
  const raw = greeks?.iv as any;
  if (raw == null) return null;
  if (typeof raw === "number") {
    // If it's a decimal (<= 1), convert to percent; if already like 68, leave it.
    const val = raw <= 1 ? raw * 100 : raw;
    return Number.isFinite(val) ? Math.round(val) : null;
  }
  // strings fallback
  const n = Number(String(raw).replace("%", ""));
  return Number.isFinite(n) ? Math.round(n) : null;
})();
    const distancePct = Number.isFinite(derived?.distance_otm_pct) ? Math.abs(derived.distance_otm_pct) : null;


    let earningsSoonTxt = "none";
    if (earnings?.date) {
      const now = Date.now();
      const ed = new Date(earnings.date + "T00:00:00Z").getTime();
      const daysAway = Math.floor((ed - now) / 86_400_000);
      if (daysAway <= 0) earningsSoonTxt = `today ${earnings.when ? `(${earnings.when})` : ""}`.trim();
      else if (daysAway <= 7) earningsSoonTxt = `in ${daysAway} day(s) ${earnings.when ? `(${earnings.when})` : ""}`.trim();
      else if (daysAway <= 30) earningsSoonTxt = `in ~${daysAway} day(s)`;
    }


    const macroSoon = (macro_events || [])
      .filter((e: any) => {
        if (!e?.date) return false;
        const md = new Date(e.date + "T00:00:00Z").getTime();
        const days = Math.floor((md - Date.now()) / 86_400_000);
        return days >= 0 && days <= 7;
      })
      .map((e: any) => `${e.title} on ${e.date}${e.time ? " " + e.time : ""}`);


    const priorityHints = {
      earnings_window: earningsSoonTxt,
      macro_soon: macroSoon,
      iv_pct: ivPct,
      deep_otm_pct: distancePct,
      dte,
    };


    return `Analyze this options trade:


Trade:
- Ticker: ${ticker}
- Type: ${optionType}
- Strike: ${strike}
- Expiry: ${expiry}
- Spot: ${spot ?? "N/A"}
- DTE: ${dte}


Greeks:
- Delta: ${greeks?.delta ?? "N/A"}
- Gamma: ${greeks?.gamma ?? "N/A"}
- Theta: ${greeks?.theta ?? "N/A"}
- Vega: ${greeks?.vega ?? "N/A"}
- IV (%): ${ivPct ?? "N/A"}
- Open Interest: ${greeks?.openInterest ?? "N/A"}


Derived:
- Moneyness ratio: ${Number.isFinite(derived?.moneyness) ? derived.moneyness : "N/A"}
- Distance OTM %: ${Number.isFinite(derived?.distance_otm_pct) ? derived.distance_otm_pct.toFixed(2) + "%" : "N/A"}
- Breakeven: ${Number.isFinite(derived?.breakeven) ? derived.breakeven : "N/A"}
- Breakeven gap %: ${Number.isFinite(derived?.breakeven_gap_pct) ? derived.breakeven_gap_pct.toFixed(2) + "%" : "N/A"}
- Theta per $100: ${Number.isFinite(derived?.theta_per_100) ? derived.theta_per_100 : "N/A"}
- Vega per $100 per 1 vol-pt: ${Number.isFinite(derived?.vega_per_volpt_per_100) ? derived.vega_per_volpt_per_100 : "N/A"}


Context:
- Earnings: ${earnings?.date ? `${earnings.date}${earnings.when ? " (" + earnings.when + ")" : ""}${earnings.confirmed ? ", confirmed" : ", estimated"}` : "none in range"}
- Macro (next 6): ${(payload?.macro_events || []).map((e: any) => `${e.title} on ${e.date}${e.time ? " " + e.time : ""}`).join(" | ") || "none"}


Priority hints (steer the analysis):
${JSON.stringify(priorityHints)}
${
  payload.ownsPosition
    ? "User ALREADY OWNS the contract. Tailor advice to managing/adjusting/closing."
    : "User DOES NOT OWN this yet (prospecting). Tailor advice to ENTRY timing, limit price, risk budget, and conditions to skip. Avoid 'take profits/trim' language."
}

Remember: Explain *drivers*, not definitions. Score can be decimal.`;
  }
function makeRoutesUserPrompt(input: {
  finalScore: number;
  type: "CALL" | "PUT";
  strike: number;
  spot: number;
  dte: number;
  iv: number | null;
  theta: number | null;
  delta: number | null;
  gamma: number | null;
  pricePaid: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  pnlPct: number | null;
  breakevenGapPct: number | null;
  earningsDays: number | null;
  macroSoon: string | null;
  liquidityOi: number | null;
  spreadWide: boolean | null;
  // ✅ NEW:
  ownsPosition?: boolean;
}) {
  const {
    finalScore, type, strike, spot, dte,
    iv, theta, delta, gamma,
    pricePaid, bid, ask, last, mark, pnlPct,
    breakevenGapPct, earningsDays, macroSoon, liquidityOi, spreadWide,
    ownsPosition,
  } = input;

  return `
We are deciding ONLY about this specific option contract (no switching tickers, no hedges).

User context:
- Owns position: ${ownsPosition ? "YES" : "NO (prospecting)"}
- Score (0-10): ${finalScore}
- Type/Strike/Spot: ${type} / ${strike} / ${Number.isFinite(spot) ? spot : "N/A"}
- DTE: ${dte}
- IV%: ${iv ?? "N/A"} | Theta/day (per contract $): ${theta ?? "N/A"} | Delta: ${delta ?? "N/A"} | Gamma: ${gamma ?? "N/A"}
- Bid/Ask/Last/Mark: ${bid ?? "—"} / ${ask ?? "—"} / ${last ?? "—"} / ${mark ?? "—"}
- Price paid: ${pricePaid ?? "N/A"} | PnL%: ${pnlPct ?? "N/A"}
- Breakeven gap %: ${breakevenGapPct ?? "N/A"}
- Earnings in days: ${earningsDays ?? "N/A"} | Macro soon: ${macroSoon ?? "none"}
- OI (liquidity): ${liquidityOi ?? "N/A"} | Spread wide: ${spreadWide ?? "N/A"}
- Price guidance: ${USE_PRICE_GUIDANCE ? "price-specific" : "generic-only"}

Instructions:
${ownsPosition
  ? `Provide 3 routes for managing an existing position:
- Aggressive Approach: e.g., "Let it ride small / add / tight stop" plus ONE guardrail
- Middle of the Road: "Hold with conditions / partial trim / roll if X"
- Conservative Approach: "Take profits / close / reduce risk"

Then output ONE pick ("If it was me"): route + reason.`
  : `Provide 3 routes for ENTRY decision (user does NOT own it):
- Aggressive Entry: "Probe small at limit $X / breakout entry" + ONE guardrail
- Measured Entry: "Wait for pullback / tighter limit / require signal X"
- Conservative Route: "Skip", with rationale why skipping is wise

Then output ONE pick ("If it was me"): route + reason. Avoid ‘take profit/trim’ since user isn’t in.`
}

Output strictly JSON:
{
  "routes": {
    "aggressive": {"label": "...", "action": "...", "rationale": "...", "guardrail": "..." | null},
    "middle": {"label": "...", "action": "...", "rationale": "...", "guardrail": "..." | null},
    "conservative": {"label": "...", "action": "...", "rationale": "...", "guardrail": "..." | null}
  },
  "pick": {"route": "aggressive|middle|conservative", "reason": "string"}
}
`.trim();
}

function makeFallbackPlan(args: {
  dte: number;
  ivPct: number | null;
  spreadWide: boolean | null;
  explainers: string[];
}): { likes: string[]; watchouts: string[]; plan: string } {
  const likes: string[] = [];
  const watchouts: string[] = [];

  if (args.ivPct != null && args.ivPct < 50) likes.push("IV is reasonable — not nosebleed.");
  likes.push("Near the money so delta actually moves with the stock.");
  likes.push("Trend is constructive; buyers showed up on dips recently.");

  if (args.dte <= 7) watchouts.push("Theta speeds up inside ~7 DTE — time matters.");
  if (args.spreadWide === true) watchouts.push("Spread is wide; execution penalty is real.");
  watchouts.push("Breakeven needs a decent push — chop bleeds premium.");

  const plan =
    "Wait for a pullback to prior support plus a higher low, then take a small starter only after reclaiming yesterday’s high with volume. " +
    "Guardrails: skip if the spread widens > ~8%; invalid if it closes back inside yesterday’s range; time stop after 2 sessions if momentum never shows. ";

  const extra = (args.explainers || []).slice(0, 2);
  return { likes, watchouts, plan: extra.length ? plan : plan };
}
// analyzeWithAI — rewritten to use Netlify Function (server-side OpenAI key)
// Assumes you have a Netlify function at "/.netlify/functions/openai-chat" that forwards
// { model, temperature, messages, response_format? } to OpenAI's Chat Completions API
// and returns the raw OpenAI response shape (with .choices[0].message.content).
// If your function name/path differs, update OPENAI_FN below.

async function analyzeWithAI(opts: AnalyzeOpts = {}) {
  console.log("analyzeWithAI start");
  try {
    // Basic guards
    if (!form?.ticker || !form?.type || !form?.strike || !form?.expiry) return;

    const consideringEntry = form.pricePaid === "" || form.pricePaid == null;

    setIsGenLoading(true);
     
     function parsePlanJSON(txt: string): PlanOut | null {
  try {
    const j = JSON.parse(txt);
    if (Array.isArray(j?.likes) && Array.isArray(j?.watchouts) && typeof j?.plan === "string") {
      return { likes: j.likes.slice(0, 6), watchouts: j.watchouts.slice(0, 6), plan: j.plan.trim() };
    }
  } catch {}
  return null;
}
    const toNumOrNull = (s: string) =>
      s && s !== "—" && isFinite(Number(s)) ? Number(s) : null;

    const ivPctToFloat = (s: string) => {
      if (!s || s === "—") return null;
      const z = Number(String(s).replace("%", ""));
      return Number.isFinite(z) ? z / 100 : null;
    };

    // ---------- numeric greeks ----------
    const greeksNumbers: NumericGreeks =
      opts?.greeksOverride ?? {
        delta: toNumOrNull(greeks.delta),
        gamma: toNumOrNull(greeks.gamma),
        theta: toNumOrNull(greeks.theta),
        vega: toNumOrNull(greeks.vega),
        iv: ivPctToFloat(greeks.iv),
        openInterest: toNumOrNull(greeks.openInterest),
      };

    // ---------- derived ----------
    const d = buildDerived({
      spot: form.spot === "" ? null : Number(form.spot),
      strike: Number(form.strike),
      optionType: form.type as "CALL" | "PUT",
      pricePaid: form.pricePaid === "" ? null : Number(form.pricePaid),
      greeks: greeksNumbers,
      daysToExpiry,
    });

    // ---------- context for drivers ----------
    const ivPct =
      Number.isFinite(greeksNumbers.iv as number)
        ? Math.round((greeksNumbers.iv as number) * 100)
        : null;

    let earningsSoonTxt = "none";
    if (earnings?.date) {
      const now = Date.now();
      const ed = new Date(earnings.date + "T00:00:00Z").getTime();
      const daysAway = Math.floor((ed - now) / 86_400_000);
      if (daysAway <= 0)
        earningsSoonTxt = `today ${earnings.when ? `(${earnings.when})` : ""}`.trim();
      else if (daysAway <= 7)
        earningsSoonTxt = `in ${daysAway} day(s) ${earnings.when ? `(${earnings.when})` : ""}`.trim();
      else if (daysAway <= 30) earningsSoonTxt = `in ~${daysAway} day(s)`;
    }

    const macroSoon = (econEvents || [])
      .filter((e) => {
        if (!e?.date) return false;
        const md = new Date(e.date + "T00:00:00Z").getTime();
        const days = Math.floor((md - Date.now()) / 86_400_000);
        return days >= 0 && days <= 7;
      })
      .map((e) => `${e.title} on ${e.date}${e.time ? " " + e.time : ""}`);

    // ---------- drivers + nudges ----------
    const localDrivers = buildScoreDrivers({
      dte: daysToExpiry,
      ivPct,
      distance_otm_pct: d.distance_otm_pct,
      delta: greeksNumbers.delta,
      theta: greeksNumbers.theta,
      vega: greeksNumbers.vega,
      oi: greeksNumbers.openInterest,
      breakeven_gap_pct: d.breakeven_gap_pct,
      earningsSoonTxt,
      macroSoon,
    });

    const nudge = computeScoreNudge({
      dte: daysToExpiry,
      ivPct,
      distance_otm_pct: d.distance_otm_pct,
      oi: greeksNumbers.openInterest,
      breakeven_gap_pct: d.breakeven_gap_pct,
    });

    // ---------- prompts ----------
    const systemPrompt = makeBuddySystemPrompt();
    const userPrompt = makeBuddyUserPrompt({
      ticker: form.ticker.toUpperCase(),
      optionType: form.type as "CALL" | "PUT",
      strike: Number(form.strike),
      expiry: form.expiry,
      pricePaid: form.pricePaid === "" ? null : Number(form.pricePaid),
      spot: form.spot === "" ? null : Number(form.spot),
      greeks: greeksNumbers,
      macro_events: (econEvents || []).slice(0, 6),
      earnings,
      derived: d,
      ownsPosition: !consideringEntry,
      dte: daysToExpiry,
    });

setIsGenLoading(true);
setLlmStatus("Analyzing…");

/* ---------- Compute PnL + profitHint *before* calling OpenAI ---------- */
const paidVal = (() => {
  const refMark =
    opts?.quoteOverride && Number.isFinite(opts.quoteOverride.mark as any)
      ? (opts.quoteOverride.mark as number)
      : undefined;
  const n = normalizePaid(form.pricePaid, refMark);
  return Number.isFinite(n as any) ? (n as number) : NaN;
})();

const q = opts?.quoteOverride;
const mid =
  q && Number.isFinite(q?.bid as any) && Number.isFinite(q?.ask as any) && (q!.ask as number) > 0
    ? (((q!.bid as number) + (q!.ask as number)) / 2)
    : NaN;
const markNow = Number.isFinite(mid)
  ? mid
  : (q && Number.isFinite(q?.last as any) ? (q!.last as number)
  : (q && Number.isFinite(q?.mark as any) ? (q!.mark as number) : NaN));

const pnlPct = Number.isFinite(paidVal) && Number.isFinite(markNow)
  ? ((markNow - paidVal) / paidVal) * 100
  : null;

let profitHint: string | null = null;
if (pnlPct != null && pnlPct >= 50) {
  profitHint =
    "User is up ≥50% on this contract. Emphasize paying yourself and not letting it round-trip to red. Suggest partial take-profit (e.g., 1/3–1/2), trail stop above breakeven (breakeven + slippage), and a time stop (e.g., 1 week before expiry or ahead of high-impact macro). Avoid adding risk.";
}

/* ---------- Netlify OpenAI proxy helper ---------- */
const OPENAI_FN = "/.netlify/functions/openai-analyze";
async function callOpenAIProxy(body: any) {
  const r = await fetch(OPENAI_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      context: {
        ...(body?.context || {}),
        hints: [
          ...(body?.context?.hints || []),
          ...(profitHint ? [profitHint] : []),
        ],
      },
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`OpenAI proxy ${r.status} ${t}`.trim());
  }
  return await r.json();
}

/* ---------- Call OpenAI (strict JSON first, then fallback) ---------- */
async function callOpenAI(useStrictJson: boolean) {
  return await callOpenAIProxy({
    model: "gpt-4o-mini",
    temperature: 0.4,
    max_tokens: 900,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    ...(useStrictJson ? { response_format: { type: "json_object" } } : {}),
  });
}

let resp;
try {
  resp = await callOpenAI(true);
} catch (err: any) {
  addDebug("OpenAI strict JSON failed, retrying", err);
  resp = await callOpenAI(false);
}

/* ---------- Parse JSON safely ---------- */
const rawTxt = resp?.choices?.[0]?.message?.content ?? "";
if (!rawTxt) addDebug("[AI] empty content", resp);

let parsedJSON: any = {};
try {
  parsedJSON = JSON.parse(rawTxt.trim());
} catch (err) {
  addDebug("AI JSON parse error, attempting brace-slice", err);
  const match = String(rawTxt).match(/\{[\s\S]*\}/);
  if (match) {
    try {
      parsedJSON = JSON.parse(match[0]);
    } catch (err2) {
      addDebug("AI JSON parse failed again", err2);
      parsedJSON = {};
    }
  } else {
    parsedJSON = {};
  }
}

const safeNarr = sanitizeNarrative(parsedJSON?.narrative);

/* ---------- base rule score (fallback) ---------- */
const ruleOnly = computeRuleRiskScore({
  dte: daysToExpiry,
  ivPct,
  distance_otm_pct: d.distance_otm_pct,
  oi: greeksNumbers.openInterest,
  breakeven_gap_pct: d.breakeven_gap_pct,
  earningsSoonTxt,
  macroSoon,
});

const clampScore = (n: any) =>
  Number.isFinite(n) ? Math.max(0, Math.min(10, Number(n))) : ruleOnly;

/* ---------- combine AI score + nudges ---------- */
const baseScore = clampScore(parsedJSON?.score);

/* ---------- Cushion nudges (uses pnlPct already computed) ---------- */
const dteForNudge = Number.isFinite((daysToExpiry as any)) ? (daysToExpiry as number) : 999;

let cushionN = 0;
if (pnlPct !== null) {
  if (pnlPct <= -60) cushionN += 1.8;
  else if (pnlPct <= -40) cushionN += 0.9;
  else if (pnlPct <= -20) cushionN += 0.5;
  else if (pnlPct >= 80) cushionN -= 1.0;
  else if (pnlPct >= 40) cushionN -= 0.7;
  else if (pnlPct >= 20) cushionN -= 0.4;

  if (dteForNudge <= 10 && pnlPct < 0) cushionN += 0.3; // short DTE & red = riskier
  if (dteForNudge <= 5  && pnlPct > 0) cushionN += 0.1; // very short & green = tiny bump
}
console.log("[CUSHION] paid, mark, pnl%, dte, cushionN:", paidVal, markNow, pnlPct, dteForNudge, cushionN);

/* ---- FINAL SCORE ---- */
const CALIBRATION = { scale: 0.85, bias: -1.2 };
const recenter = (s: number) => (s * CALIBRATION.scale) + CALIBRATION.bias;
const finalScore = Math.max(0, Math.min(10, recenter(baseScore) + nudge + cushionN));
    // ---------- Inputs for "What I'd do if I were you" ----------
    const ivPctForRoutes = Number.isFinite(ivPct as any) ? (ivPct as number) : null;
    const bidNow = (q && Number.isFinite(q?.bid as any)) ? (q!.bid as number) : null;
    const askNow = (q && Number.isFinite(q?.ask as any)) ? (q!.ask as number) : null;
    const lastNow = (q && Number.isFinite(q?.last as any)) ? (q!.last as number) : null;
    const markNowForRoutes = Number.isFinite(markNow as any) ? (markNow as number) : null;

    const deltaNum = Number.isFinite(greeksNumbers.delta as any) ? Number(greeksNumbers.delta) : null;
    const gammaNum = Number.isFinite(greeksNumbers.gamma as any) ? Number(greeksNumbers.gamma) : null;
    const thetaNum = Number.isFinite(greeksNumbers.theta as any) ? Number(greeksNumbers.theta) : null;

    const pnlPctForRoutes = (pnlPct === null || !Number.isFinite(pnlPct as any)) ? null : Number(pnlPct);
    const breakevenGapPct = Number.isFinite(d.breakeven_gap_pct as any) ? Number(d.breakeven_gap_pct) : null;

    const earningsDays = (() => {
      if (!earnings?.date) return null;
      const ed = new Date(earnings.date + "T00:00:00Z").getTime();
      return Math.floor((ed - Date.now()) / 86_400_000);
    })();

    const macroSoonStr = (() => {
      const near = (econEvents || []).find((e) => {
        const md = new Date(e.date + "T00:00:00Z").getTime();
        const d = Math.floor((md - Date.now()) / 86_400_000);
        return d >= 0 && d <= 7;
      });
      return near ? near.title : null;
    })();

    const liquidityOi = Number.isFinite(greeksNumbers.openInterest as any)
      ? Number(greeksNumbers.openInterest)
      : null;

    const spreadWide = (Number.isFinite(bidNow as any) && Number.isFinite(askNow as any) && (askNow as number) > 0)
      ? (((askNow as number) - (bidNow as number)) / (askNow as number) > 0.15)
      : null;

    // ---------- LLM explainers filtered + insights base ----------
    const llmExplainers: string[] = Array.isArray(parsedJSON?.explainers)
      ? parsedJSON.explainers
      : [];
    const filteredLLM = llmExplainers.filter(
      (x) => !/^(delta|theta|vega|gamma)\b.*\bis\b/i.test(String(x))
    );
    const combinedDrivers = [...localDrivers, ...filteredLLM].slice(0, 6);

    const parsed: Insights = {
      score: Math.round(finalScore * 10) / 10,
      headline: (parsedJSON?.headline ?? "").toString().slice(0, 140),
      narrative: (safeNarr ?? "").toString().slice(0, 1200),
      advice: Array.isArray(parsedJSON?.advice) ? parsedJSON.advice.slice(0, 6) : [],
      explainers: combinedDrivers,
      risks: Array.isArray(parsedJSON?.risks) ? parsedJSON.risks.slice(0, 5) : [],
      watchlist: Array.isArray(parsedJSON?.watchlist) ? parsedJSON.watchlist.slice(0, 4) : [],
      strategy_notes: Array.isArray(parsedJSON?.strategy_notes) ? parsedJSON.strategy_notes.slice(0, 3) : [],
      // keep confidence in the type if you want, but UI no longer shows it
      confidence: Number.isFinite(parsedJSON?.confidence)
        ? Math.max(0, Math.min(1, parsedJSON.confidence))
        : undefined,
    };

    setInsights(parsed);

     // --- Plan call (Pros / Watch-outs / What I'd do) ---
try {
  const planUser = makePlanUserPrompt({
    ticker: form.ticker.toUpperCase(),
    optionType: form.type as "CALL" | "PUT",
    strike: Number(form.strike),
    expiry: form.expiry,
    dte: daysToExpiry,
    ivPct,
    pnlPct: pnlPctForRoutes,
    distance_otm_pct: breakevenGapPct == null ? null : d.distance_otm_pct, // use your derived distance if available
    spreadWide,
    liquidityOi,
    earningsDays,
    macroSoon: macroSoonStr,
  });

  const planResp = await callOpenAIProxy({
    model: "gpt-4o-mini",
    temperature: 0.7,
    messages: [
      { role: "system", content: makePlanSystemPrompt() },
      { role: "user", content: planUser },
    ],
    response_format: { type: "json_object" },
  });

  const planText = planResp?.choices?.[0]?.message?.content?.trim() || "{}";
  console.log("[PLAN raw]", planText);
  const planOut = parsePlanJSON(planText);

  if (planOut) {
    setPlan(planOut);
  } else {
    const fb = makeFallbackPlan({
      dte: daysToExpiry,
      ivPct,
      spreadWide,
      explainers: combinedDrivers || [],
    });
    setPlan(fb);
  }
} catch (e) {
  addDebug("plan generation failed", e);
  const fb = makeFallbackPlan({
    dte: daysToExpiry,
    ivPct,
    spreadWide,
    explainers: combinedDrivers || [],
  });
  setPlan(fb);
}

    // ---------- AI call: "What I'd do if I were you" (3 routes + pick) ----------
    try {
      const routesUser = makeRoutesUserPrompt({
        finalScore,
        type: form.type as "CALL" | "PUT",
        strike: Number(form.strike),
        spot: form.spot === "" ? NaN : Number(form.spot),
        dte: daysToExpiry,
        iv: ivPctForRoutes,
        theta: thetaNum,
        delta: deltaNum,
        gamma: gammaNum,
        pricePaid: form.pricePaid === "" ? null : Number(form.pricePaid),
        bid: bidNow,
        ask: askNow,
        last: lastNow,
        mark: markNowForRoutes,
        pnlPct: pnlPctForRoutes,
        breakevenGapPct,
        earningsDays,
        macroSoon: macroSoonStr,
        liquidityOi,
        spreadWide,
      });

      async function callOpenAIRoutes(useStrictJson: boolean) {
        return await callOpenAIProxy({
          model: "gpt-4o-mini",
          temperature: 0.7,
          messages: [
            { role: "system", content: makeRoutesSystemPrompt() },
            { role: "user", content: routesUser },
          ],
          ...(useStrictJson ? { response_format: { type: "json_object" } } : {}),
        });
      }

      let routesResp;
      try {
        routesResp = await callOpenAIRoutes(true);
      } catch (errRoutesStrict: any) {
        addDebug("Routes strict JSON failed, retrying", errRoutesStrict);
        routesResp = await callOpenAIRoutes(false);
      }

      const routesTxt = routesResp?.choices?.[0]?.message?.content?.trim() || "{}";

      function parseRoutesLoose(s: string): any | null {
        try { return JSON.parse(s); } catch {}
        const m = s.match(/\{[\s\S]*\}/);
        if (m) { try { return JSON.parse(m[0]); } catch {} }
        return null;
      }

      const jr = parseRoutesLoose(routesTxt);

      const isValid =
        jr && jr.routes && jr.pick &&
        jr.routes.aggressive && jr.routes.middle && jr.routes.conservative &&
        typeof jr.routes.aggressive.action === "string" &&
        typeof jr.routes.middle.action === "string" &&
        typeof jr.routes.conservative.action === "string" &&
        (jr.pick.route === "aggressive" || jr.pick.route === "middle" || jr.pick.route === "conservative") &&
        typeof jr.pick.reason === "string"; // <- confidence no longer required

      let routesForTLDR: RoutesOut;
      if (isValid) {
        const jrNorm = normalizeRoutes(jr as RoutesOut, { dte: daysToExpiry, bidNow });
        setRoutes(jrNorm);
        routesForTLDR = jrNorm;
      } else {
        const fallbackRoutes: RoutesOut = {
          routes: {
            aggressive: { label: "Aggressive Approach", action: "—", rationale: "Could not parse AI output.", guardrail: null },
            middle:     { label: "Middle of the Road",   action: "—", rationale: "Could not parse AI output.", guardrail: null },
            conservative:{label: "Conservative Approach",action: "—", rationale: "Could not parse AI output.", guardrail: null },
          },
          pick: { route: "middle", reason: "Fallback until AI responds cleanly.", confidence: 0 }
        };
        setRoutes(fallbackRoutes);
        routesForTLDR = fallbackRoutes;
      }
    } catch (errRoutes: any) {
      addDebug("Routes AI call failed", errRoutes);
      setRoutes({
        routes: {
          aggressive: { label: "Aggressive Approach", action: "—", rationale: "AI unavailable.", guardrail: null },
          middle:     { label: "Middle of the Road",   action: "—", rationale: "AI unavailable.", guardrail: null },
          conservative:{label: "Conservative Approach",action: "—", rationale: "AI unavailable.", guardrail: null },
        },
        pick: { route: "middle", reason: "Fallback due to error.", confidence: 0 }
      });
    }

        setLlmStatus("Done");
  } catch (e: any) {
    setLlmStatus(e?.message ?? "AI error");
    addDebug("analyzeWithAI error", e);
  } finally {
    setIsGenLoading(false);
  }
}



  // -----------------------------
  // FINNHUB: CHAIN + SPOT
  // -----------------------------
 // Option chain via Netlify proxy (no FINNHUB_KEY in browser)
async function fetchOptionChain(symbol: string, opts?: { force?: boolean }) {
  const s = symbol.trim().toUpperCase();
  if (!s) {
    const err = new Error("Missing symbol");
    addDebug("fetchOptionChain aborted", err);
    throw err;
  }
  if (!opts?.force && chainCache.current.has(s)) {
    return chainCache.current.get(s)!;
  }

  const j: any = await finnhub(`/stock/option-chain?symbol=${encodeURIComponent(s)}`);
  const data = Array.isArray(j?.data) ? j.data : [];
  chainCache.current.set(s, data);
  return data;
}
  const getExpirationRaw = (d: any) =>
    d?.expirationDate ?? d?.expiration ?? d?.expiry ?? d?.expDate ?? null;

// Pick the nearest expiry date (closest >= today; else overall closest)
function pickNearestExpiry(dates: string[]): string {
  if (!Array.isArray(dates) || dates.length === 0) return "";
  const today = new Date().toISOString().slice(0, 10);
  const future = dates.filter((d) => d >= today).sort();
  return (future.length ? future[0] : dates.slice().sort()[0]) || "";
}
// Expirations for an underlying (Polygon; chunked + fallback, no helpers)
async function loadExpirations(tkr: string) {
   let out: string[] = [];
  const TKR = String(tkr || "").trim().toUpperCase();
  if (!TKR) {
    setExpirations([]);
    return;
  }

  setLoadingExp(true);
  try {
// smaller page; we’ll paginate
const basePath =
  `/v3/reference/options/contracts` +
  `?underlying_ticker=${encodeURIComponent(TKR)}` +
  `&limit=500`;

const today = new Date().toISOString().slice(0, 10);

function extractContracts(j: any): any[] {
  if (!j) return [];
  if (Array.isArray(j.results)) return j.results;
  if (Array.isArray(j.data))    return j.data;
  if (j.body) {
    if (Array.isArray(j.body.results)) return j.body.results;
    if (Array.isArray(j.body.data))    return j.body.data;
  }
  return [];
}

// Try to pull the "cursor" token out of any next_* field Polygon returns
function nextCursorFrom(j: any): string | null {
  const candidates = [j?.next_cursor, j?.cursor, j?.next, j?.next_url];
  for (const v of candidates) {
    if (!v) continue;
    if (typeof v === "string") {
      // If it’s a full URL or a path, parse ?cursor=
      const m = v.match(/[?&]cursor=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
      // Sometimes it’s already just the token:
      if (!v.includes("http") && !v.includes("?")) return v;
    }
  }
  return null;
}

// Paginated fetch: gather up to ~40 distinct future expirations (max 6 pages)
async function fetchPaged(suffix: string, maxPages = 6, minUniqueExp = 40) {
  let arr: any[] = [];
  let uniqExp = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const path = `${basePath}${suffix}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const url  = `/.netlify/functions/polygon-proxy?path=${encodeURIComponent(path)}`;
    console.log("[POLY expiries] URL:", url);

    const r = await fetch(url);
    console.log("[POLY expiries] status:", r.status);
    if (!r.ok) break;

    const j = await r.json();
    const chunk = extractContracts(j);
    arr.push(...chunk);

    // Track unique future expirations as we go (so we can early-stop)
    for (const c of chunk) {
      const d = String(c?.expiration_date || c?.expirationDate || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today) uniqExp.add(d);
    }

    const next = nextCursorFrom(j);
    if (!next) break;
    cursor = next;

    if (uniqExp.size >= minUniqueExp) break;
  }

  console.log("[POLY expiries] paged total:", arr.length, "unique expirations:", Array.from(new Set(arr.map(c => String(c?.expiration_date || c?.expirationDate || "").slice(0,10)))).length);
  return arr;
}

// 1) First attempt — current contracts only (active=true), split by contract_type
let calls = await fetchPaged(`&active=true&contract_type=call`);
let puts  = await fetchPaged(`&active=true&contract_type=put`);
let arr   = [...calls, ...puts];

// 2) Fallback — if still empty, retry without active=true (catalog)
if (!arr.length) {
  console.warn("[POLY expiries] empty with active=true — retrying without it");
  calls = await fetchPaged(`&contract_type=call`);
  puts  = await fetchPaged(`&contract_type=put`);
  arr   = [...calls, ...puts];
}

    // 3) Dedupe + sort dates 'YYYY-MM-DD'
    const uniq = new Set<string>();
    for (const c of arr) {
      const d = String(c?.expiration_date || c?.expirationDate || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) uniq.add(d);
    }
    const list = Array.from(uniq).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    setExpirations(list);
     out = list;
// If no expiry chosen yet, auto-pick the nearest one and trigger strikes
if (!form.expiry && list.length) {
  const auto = pickNearestExpiry(list);
  setForm((f) => ({ ...f, expiry: auto }));

  // Optional: if user has already chosen CALL/PUT, kick strikes right now
  if (form.type) {
    loadStrikesForExpiry(
      TKR,
      form.type as "CALL" | "PUT",
      auto
    ).catch((e) => addDebug("Strikes (auto from expiries) error", e));
  }
}
    // 4) Clear invalid selection after ticker changes
    if (!list.includes(form.expiry)) {
      setForm((f) => ({ ...f, expiry: "" }));
    }
  } catch (e) {
    console.warn("[expirations] load error:", e);
    setExpirations([]);
  } finally {
    setLoadingExp(false);
  }
   return out;
}

function filterStrikesForView(args: {
  spot: number | null;
  all: number[];
  current: number | null;
  eachSide?: number;            // preferred: fixed count each side
  pctWindow?: number;           // legacy fallback
  minCount?: number;            // legacy fallback
}): number[] {
  const { spot, all, current } = args;

  // 1) Sanitize: finite positive only (drop 0 and negatives)
  const nums = (Array.isArray(all) ? all : [])
    .map((x: any) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (nums.length === 0) return [];

  // Helper: nearest index to target
  const closestIdx = (target: number): number => {
    let idx = 0, best = Infinity;
    for (let i = 0; i < nums.length; i++) {
      const d = Math.abs(nums[i] - target);
      if (d < best) { best = d; idx = i; }
    }
    return idx;
  };

  // 2) Preferred: count-based window around center (spot>0 → current>0 → middle)
  const eachSide =
    Number.isFinite(args.eachSide as any) ? Math.max(0, (args.eachSide as number) | 0) : null;

  if (eachSide !== null) {
    let idx: number;
    if (Number.isFinite(spot) && (spot as number) > 0) idx = closestIdx(spot as number);
    else if (Number.isFinite(current) && (current as number) > 0) idx = closestIdx(current as number);
    else idx = Math.min(nums.length - 1, Math.floor(nums.length / 2));

    // edge-balanced slice so we still get ~2*eachSide+1 strikes near edges
    const desired = eachSide * 2 + 1;
    let lo = idx - eachSide;
    let hi = idx + eachSide;
    if (lo < 0) { hi = Math.min(nums.length - 1, hi + (-lo)); lo = 0; }
    if (hi > nums.length - 1) { const over = hi - (nums.length - 1); lo = Math.max(0, lo - over); hi = nums.length - 1; }
    if (hi - lo + 1 < desired) {
      const need = desired - (hi - lo + 1);
      const addLo = Math.min(lo, Math.floor(need / 2));
      const addHi = Math.min(nums.length - 1 - hi, need - addLo);
      lo -= addLo; hi += addHi;
    }

    let view = nums.slice(lo, hi + 1);
    if (current != null && current > 0 && !view.includes(current)) view.push(current);
    return [...new Set(view)].sort((a, b) => a - b);
  }

  // 3) Legacy fallback: %-window until minCount (kept for safety)
  const pctWindow = Number.isFinite(args.pctWindow as any) ? (args.pctWindow as number) : 0.25;
  const minCount  = Number.isFinite(args.minCount  as any) ? Math.max(1, args.minCount  as number) : 30;

  if (!Number.isFinite(spot) || (spot as number) <= 0) {
    const head = nums.slice(0, Math.min(nums.length, minCount));
    if (current != null && current > 0 && !head.includes(current)) head.push(current);
    return [...new Set(head)].sort((a, b) => a - b);
  }

  const s = spot as number;
  let w = Math.max(0.01, pctWindow);
  let lo2 = s * (1 - w);
  let hi2 = s * (1 + w);
  let view2 = nums.filter((x) => x >= lo2 && x <= hi2);
  while (view2.length < minCount && w < 1.0) {
    w *= 1.25; lo2 = s * (1 - w); hi2 = s * (1 + w);
    view2 = nums.filter((x) => x >= lo2 && x <= hi2);
  }
  if (current != null && current > 0 && !view2.includes(current)) view2.push(current);
  return [...new Set(view2)].sort((a, b) => a - b);
}
  function extractLegsForType(node: any, type: "CALL" | "PUT") {
    if (Array.isArray(node?.calls) || Array.isArray(node?.puts))
      return type === "CALL" ? node?.calls ?? [] : node?.puts ?? [];
    if (node?.options && Array.isArray(node.options[type])) return node.options[type];
    const lc = type.toLowerCase();
    if (Array.isArray(node?.[lc])) return node[lc];
    return [];
  }
// Load strikes ONLY for the chosen expiry (Polygon; no Finnhub dependency)
async function loadStrikesForExpiry(tkr: string, type: "CALL" | "PUT", expiryYMD: string) {
  // Guard
  if (!tkr || !type || !expiryYMD) {
    setAllStrikes([]);
    setStrikes([]);
    return;
  }

  setLoadingStrikes(true);
  try {
    // Normalize inputs
    const TKR = String(tkr).trim().toUpperCase();
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(expiryYMD)
      ? expiryYMD
      : (() => {
          const s = String(expiryYMD || "").trim();
          if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
            const [Y, M, D] = s.split("-");
            return `${Y}-${M.padStart(2, "0")}-${D.padStart(2, "0")}`;
          }
          return s;
        })();

    // Pull contracts for that exact expiry from Polygon v3 via your Netlify proxy
    const path = `/v3/reference/options/contracts?underlying_ticker=${encodeURIComponent(
      TKR
    )}&expiration_date=${encodeURIComponent(ymd)}&limit=1000&active=true`;

    const r = await fetch(`/.netlify/functions/polygon-proxy?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error(`polygon strikes ${r.status}`);
    const j = await r.json();

    // Map strictly from returned contracts
    const arr: any[] =
      (Array.isArray(j?.results) && j.results) ||
      (Array.isArray(j?.data) && j.data) ||
      [];

    // Keep real decimals (e.g., 172.5)
    const uniq = new Set<number>();
    for (const c of arr) {
      const cp = (c?.contract_type || c?.type || "").toUpperCase();
      if (cp && (cp.startsWith("C") ? "CALL" : "PUT") !== type) continue;

      const sp = Number(c?.strike_price ?? c?.strikePrice);
      if (Number.isFinite(sp) && sp > 0) uniq.add(sp);
    }

    const list = Array.from(uniq).sort((a, b) => a - b);

    // Save full list for this expiry
    setAllStrikes(list);

    // Build visible window around spot/current (your existing helper)
    const spotNum =
      form.spot !== "" && Number.isFinite(Number(form.spot)) && Number(form.spot) > 0
        ? Number(form.spot)
        : null;

    const curr =
      Number.isFinite(Number(form.strike)) && Number(form.strike) > 0
        ? Number(form.strike)
        : null;

    let view = showAllStrikes
      ? [...list]
      : filterStrikesForView({
          spot: spotNum,
          all: list,
          current: curr,
          eachSide: STRIKES_EACH_SIDE,
        });

    if (!Array.isArray(view) || view.length === 0) view = [...list];
    if (curr != null && !view.includes(curr)) view.push(curr);
    view.sort((a, b) => a - b);
    setStrikes(view);

    // If the old strike isn’t valid for this expiry, clear it (auto-select will repopulate)
    if (!list.includes(Number(form.strike))) {
      strikeTouchedRef.current = false;
      setForm((f) => ({ ...f, strike: "" }));
    }
  } catch (e) {
    console.warn("[strikes] loadStrikesForExpiry error:", e);
    setAllStrikes([]);
    setStrikes([]);
  } finally {
    setLoadingStrikes(false);
  }
}


 // Spot (Finnhub) — via Netlify proxy (no FINNHUB_KEY in browser)
async function loadSpot(ticker: string, opts?: { silent?: boolean }) {
  if (!ticker.trim()) return;
  if (!opts?.silent) setSpotLoading(true);
  try {
    const j: any = await finnhub(`/quote?symbol=${encodeURIComponent(ticker.toUpperCase())}`);

    // Finnhub fields:
    // c = current/last, o = today's open, d = abs change, dp = % change
    const price = Number(j?.c);
    const open  = Number(j?.o);

    if (Number.isFinite(price)) {
      setForm((f) => ({
        ...f,
        spot: String(price),
        // keep previous open if API skipped it
        open: Number.isFinite(open) ? String(open) : f.open,
      }));
    } else {
      addDebug("loadSpot: no valid price in Finnhub response", j);
    }
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("429")) {
      spotCooldownUntil.current = Date.now() + 60_000;
      addDebug("loadSpot: Finnhub rate-limited (429) — cooling down 60s");
    } else {
      addDebug("loadSpot error", e);
    }
  } finally {
    if (!opts?.silent) setSpotLoading(false);
  }
}


  // -----------------------------
  // POLYGON: CONTRACT SNAPSHOT (Greeks, IV, OI)
  // -----------------------------
  function toIsoDate(userDate: string): string {
    const s = userDate.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
    if (!m) throw new Error(`Bad date: ${userDate}`);
    let [_, mm, dd, yy] = m as any;
    const year =
      (yy as string).length === 2 ? (Number(yy) >= 70 ? `19${yy}` : `20${yy}`) : (yy as string);
    const pad = (n: string) => n.padStart(2, "0");
    return `${year}-${pad(mm as string)}-${pad(dd as string)}`;
  }
  function nearlyEqual(a: number, b: number, tol = 0.01) {
    return Math.abs(a - b) <= tol;
  }


// TRADIER-ONLY: get bid/ask/last/mark (+ greeks/iv/oi if available) via serverless proxy
async function loadPolygonGreeks(
  ticker: string,
  expiryInput: string,         // "YYYY-MM-DD"
  typeLower: "call" | "put",
  strikeInput: string
): Promise<{
  numericGreeks: NumericGreeks;
  contract: string;
  quoteNum: { bid: number | null; ask: number | null; last: number | null; mark: number | null };
} | null> {
  try {
    const TRADIER_PROXY =
      (import.meta as any).env?.VITE_TRADIER_PROXY_URL || "/.netlify/functions/tradier-quote";

    const num = (x: any): number | null => {
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    };
    const isNum = (x: any): x is number => Number.isFinite(x);

    // ---- Build OCC/Polygon-style option symbol ----
    function fmtYYMMDD(iso: string) {
      const d = new Date(iso + "T00:00:00Z");
      if (Number.isNaN(d.getTime())) return null;
      const yy = String(d.getUTCFullYear()).slice(-2);
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      return `${yy}${mm}${dd}`;
    }
    function fmtStrike8(x: number) {
      const k = Math.round(x * 1000); // OCC uses strike*1000 padded
      return String(k).padStart(8, "0");
    }

    const yymmdd = fmtYYMMDD(expiryInput);
    const right = typeLower === "call" ? "C" : "P";
    const strikeNum = Number(strikeInput);
    if (!yymmdd || !Number.isFinite(strikeNum)) {
      setPolyStatus("Tradier failed: bad expiry or strike");
      return null;
    }

    // Keep returning contract with "O:" since your UI uses it elsewhere
    const contract = `O:${ticker.toUpperCase()}${yymmdd}${right}${fmtStrike8(strikeNum)}`;
    const tradierSym = contract.slice(2); // strip "O:"
// ---- Try Polygon for Greeks (keep Tradier for quotes) ----
// ---- Try Polygon for Greeks (keep Tradier for quotes) ----
// ---- Try Polygon for Greeks (keep Tradier for quotes) ----
// ---- Try Polygon for Greeks (contract snapshot endpoint) ----
const POLY_KEY = (import.meta as any).env?.VITE_POLYGON_KEY;
let polyGreeks: NumericGreeks | null = null;

if (POLY_KEY) {
  try {
    // Correct endpoint: /v3/snapshot/options/{underlyingAsset}/{optionContract}
    const polyUrl =
      `https://api.polygon.io/v3/snapshot/options/${ticker.toUpperCase()}/${encodeURIComponent(contract)}?apiKey=${POLY_KEY}`;

    const pr = await fetch(polyUrl, { headers: { Accept: "application/json" } });
    const pj = await pr.json();
    console.log("[POLY CONTRACT RAW]", pj);

    const res = pj?.results; // single object (not array)
    if (res) {
      const gg = res?.greeks ?? {};
      const toNum = (v: any) => (Number.isFinite(+v) ? +v : NaN);

      polyGreeks = {
        delta: toNum(gg?.delta),
        gamma: toNum(gg?.gamma),
        theta: toNum(gg?.theta),
        vega:  toNum(gg?.vega),
        iv:    toNum(res?.implied_volatility),
        openInterest: toNum(res?.open_interest),
      };

      console.log("[POLY CONTRACT PARSED]", polyGreeks);
    } else {
      console.warn("[POLY CONTRACT] results empty for", { ticker, contract });
    }
  } catch (err) {
    console.warn("[POLY CONTRACT] fetch/parse failed; will rely on Tradier fallback", err);
  }
}
// ---- Call Tradier proxy (quotes only; greeks as fallback) ----
const r = await fetch(`${TRADIER_PROXY}?symbol=${encodeURIComponent(tradierSym)}&greeks=1`, {
  headers: { Accept: "application/json" },
});
if (!r.ok) {
  setPolyStatus(`Tradier failed: ${r.status}`);
  return null;
}
const j = await r.json();

console.log("[TRADIER SNAP]", j, {
  bid: j?.bid, ask: j?.ask, last: j?.last, mark: j?.mark,
  delta: j?.delta, gamma: j?.gamma, theta: j?.theta, vega: j?.vega, iv: j?.iv
});

// Quotes
let bidNum = num(j?.bid);
let askNum = num(j?.ask);
let lastNum = num(j?.last);
let markNum = num(j?.mark);
if (!isNum(markNum)) {
  if (isNum(bidNum) && isNum(askNum) && (askNum as number) > 0) {
    markNum = ((bidNum as number) + (askNum as number)) / 2;
  } else if (isNum(lastNum)) {
    markNum = lastNum as number;
  }
}

// ---- Prefer Polygon Greeks; fallback to Tradier fields if Polygon missing ----
const pick = (pg: number | undefined | null, tj: any) =>
  Number.isFinite(pg as any) ? (pg as number) : (Number.isFinite(+tj) ? +tj : NaN);

const numericGreeks: NumericGreeks = {
  delta: pick(polyGreeks?.delta, j?.delta),
  gamma: pick(polyGreeks?.gamma, j?.gamma),
  theta: pick(polyGreeks?.theta, j?.theta),
  vega:  pick(polyGreeks?.vega,  j?.vega),
  iv:    pick(polyGreeks?.iv,    j?.iv ?? j?.implied_volatility),
  openInterest: Number.isFinite(+j?.openInterest) ? +j.openInterest
                : Number.isFinite(+j?.open_interest) ? +j.open_interest
                : (Number.isFinite(polyGreeks?.openInterest as any) ? (polyGreeks!.openInterest as number) : NaN),
};

const quoteNum = {
  bid:  isNum(bidNum)  ? bidNum  : null,
  ask:  isNum(askNum)  ? askNum  : null,
  last: isNum(lastNum) ? lastNum : null,
  mark: isNum(markNum) ? markNum : null,
};

console.log("[CUSHION] merged quote+greeks:", { quoteNum, numericGreeks, contract });

return { numericGreeks, contract, quoteNum };
  } catch (e: any) {
    console.error("loadPolygonGreeks (tradier-only) error", e);
    addDebug("loadPolygonGreeks (tradier-only) error", e);
    setPolyStatus(`Tradier failed: ${e?.message ?? e}`);
    setGreeks({ delta: "—", gamma: "—", theta: "—", vega: "—", iv: "—", openInterest: "—" });
    setMatchedContract("");
    return null;
  }
}


  // -----------------------------
  // NEWS & EVENTS
  // -----------------------------
  function scoreHeadline(h: Headline, tkr: string) {
    const title = (h.title || "").toLowerCase();
    let s = 0;
    const high = [
      "downgrade",
      "upgrade",
      "cuts guidance",
      "raises guidance",
      "guidance",
      "lawsuit",
      "sues",
      "sec",
      "merger",
      "acquisition",
      "takeover",
      "bankruptcy",
      "chapter 11",
      "halt",
      "recall",
      "restates",
      "earnings",
      "eps",
      "revenue",
      "outlook",
      "misses",
      "beats",
      "profit warning",
      "fomc",
      "fed",
      "powell",
      "cpi",
      "inflation",
      "pce",
      "jobs",
      "payroll",
      "minutes",
      "rate",
      "breach",
      "hack",
      "outage",
      "strike",
      "union",
      "fda",
      "approval",
      "crl",
    ];
    const med = [
      "analyst",
      "price target",
      "pt",
      "buyback",
      "dividend",
      "share repurchase",
      "layoffs",
      "hiring",
    ];
    for (const w of high) if (title.includes(w)) s += 50;
    for (const w of med) if (title.includes(w)) s += 15;
    if ((h.source || "").toLowerCase().match(/sec|doj|fcc|treasury|federal reserve/)) s += 20;
    if (title.includes(tkr.toLowerCase())) s += 10;
    if (h.ts) {
      const ageHrs = (Date.now() - h.ts) / 3_600_000;
      if (ageHrs <= 3) s += 25;
      else if (ageHrs <= 24) s += 10;
    }
    return s;
  }


  // Powell/featured overrides (no "manual override" label shown)
// Hard-coded overrides disabled (keep empty)
const MACRO_OVERRIDES: EconEvent[] = [];


  function uniqueMacro(list: EconEvent[]) {
    const seen = new Set<string>();
    const out: EconEvent[] = [];
    for (const e of list) {
      const key = `${(e.title || "").toLowerCase()}|${e.date}|${e.time || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
    return out;
  }



// Earnings calendar via Netlify proxy (no FINNHUB_KEY in browser)
async function fetchEarnings(symbol: string) {
  try {
    const tkr = symbol.toUpperCase().trim();
    if (!tkr) {
      setEarnings(null);
      addDebug("fetchEarnings skipped — missing symbol");
      return;
    }

    const today = new Date();
    const from = toYMD_UTC(today);
    const to = toYMD_UTC(new Date(today.getTime() + 210 * 86_400_000)); // ~210 days out

    const j: any = await finnhub(
      `/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(tkr)}`
    );

    const raw: any[] =
      (Array.isArray(j?.earningsCalendar) && j.earningsCalendar) ||
      (Array.isArray(j?.data) && j.data) ||
      (Array.isArray(j?.events) && j.events) ||
      [];

    const sameTicker = (x: any) => {
      const sym = (x?.symbol || x?.ticker || "").toString().toUpperCase();
      return (
        sym === tkr ||
        sym === `${tkr}.US` ||
        sym === `US:${tkr}` ||
        sym.endsWith(`:${tkr}`) ||
        sym === `${tkr}-USD`
      );
    };

    const parsed = raw
      .filter(sameTicker)
      .map((x: any) => {
        const dateStr = (
          x?.date || x?.earningsDate || x?.releaseDate || x?.reportDate || ""
        )
          .toString()
          .slice(0, 10);
        const dObj = new Date(dateStr + "T00:00:00Z");
        const hour = (x?.hour || x?.time || "").toString().toLowerCase();
        const confirmFlag = Boolean(
          x?.confirmed === true ||
            x?.confirmStatus === "confirmed" ||
            x?.status === "confirmed"
        );
        return {
          date: dateStr,
          dObj: isNaN(dObj.getTime()) ? null : dObj,
          hour,
          confirmed: confirmFlag,
        };
      })
      .filter((e) => e.dObj && e.dObj.getTime() >= new Date(from + "T00:00:00Z").getTime())
      .sort((a, b) => a!.dObj!.getTime() - b!.dObj!.getTime());

    if (!parsed.length) {
      setEarnings(null);
      return;
    }

    const firstDate = parsed[0].date;
    const sameDay = parsed.filter((p) => p.date === firstDate);
    const next = sameDay.find((p) => p.confirmed) || sameDay[0];

    const whenMap: Record<string, string> = {
      bmo: "Before Open",
      amc: "After Close",
      "pre-market": "Pre-Market",
      "post-market": "Post-Market",
      pm: "Post-Market",
      am: "Pre-Market",
    };
    const when = whenMap[next.hour] || (next.hour ? next.hour : undefined);

    setEarnings({ date: next.date, when, confirmed: next.confirmed });
  } catch (e) {
    addDebug("fetchEarnings error", e);
    setEarnings(null);
  }
}
// Always-on macro feed (independent of ticker)
async function fetchUpcomingMacro() {
  try {
    // Fetch FRED (CPI/PPI/Retail) + Fed (FOMC) in parallel
    const [fredRes, fedRes] = await Promise.all([
      fetch("/.netlify/functions/fred-calendar?days=180", { cache: "no-store" }),
      fetch("/.netlify/functions/fomc-schedule", { cache: "no-store" }),
    ]);

    const fredJ: any = await fredRes.json();
    const fedJ:  any = await fedRes.json();

    const fredArr: any[] = Array.isArray(fredJ?.events) ? fredJ.events : [];
    const fedArr:  any[] = Array.isArray(fedJ?.events)  ? fedJ.events  : [];

    // Map FRED → keep only CPI / PPI / Retail Sales
    const fredEvents: EconEvent[] = fredArr
      .map((ev: any) => {
        const at = typeof ev?.at === "string" ? ev.at : "";
        const date = at.slice(0, 10); // YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null as any;
        const title = String(ev?.title ?? "Macro");
        const time  = ev?.time ? String(ev.time) : "";
        const k = title.toLowerCase();
        const keep = k.includes("cpi") || k.includes("ppi") || k.includes("retail sales");
        if (!keep) return null as any;
        return { title, date, time };
      })
      .filter(Boolean) as EconEvent[];

    // Fed (FOMC) events are already normalized {title, date, time} and pre-windowed to 14 days
    const fedEvents: EconEvent[] = fedArr
      .map((e: any) =>
        e && e.date && e.title ? { title: String(e.title), date: String(e.date), time: String(e.time || "") } : null
      )
      .filter(Boolean) as EconEvent[];

    // Merge + sort asc (date+time)
    const events: EconEvent[] = [...fredEvents, ...fedEvents];
    events.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

// De-noise spammy releases:
    // - Jobless Claims: Thu only (if it ever appears)
    const filtered: EconEvent[] = [];
    for (const e of events) {
      const dowUTC = new Date(e.date + "T12:00:00Z").getUTCDay(); // 0=Sun..6=Sat (midday avoids DST slip)
      if (/^Jobless Claims\b/i.test(e.title)) {
        if (dowUTC !== 4) continue; // Thu only
      }
      filtered.push(e);
    }
     // Collapse multiple FOMC items that share the same date into one summary row
function collapseFomcSameDay(list: EconEvent[]): EconEvent[] {
  const byDate: Record<string, EconEvent[]> = {};
  for (const e of list) (byDate[e.date] ||= []).push(e);

  // preserve date order based on original list
  const dateOrder: string[] = [];
  for (const e of list) if (!dateOrder.includes(e.date)) dateOrder.push(e.date);

  const isFed = (t: string) =>
    /fomc|federal\s+funds\s+rate|press\s+conference|economic\s+projections/i.test(t);

  const out: EconEvent[] = [];
  for (const d of dateOrder) {
    const items = byDate[d] || [];
    const feds = items.filter(x => isFed(x.title));
    const nonFeds = items.filter(x => !isFed(x.title));

    if (feds.length >= 2) {
      const hasProj = feds.some(x => /projection/i.test(x.title));
      out.push({
        title: hasProj
          ? "FOMC Day (Statement, Rate, Projections, Presser)"
          : "FOMC Day (Statement, Rate, Presser)",
        date: d,
        time: "14:00",
      });
    } else {
      out.push(...feds);
    }
    out.push(...nonFeds);
  }

  // sort again by date+time to be safe
  out.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  return out;
}

// Collapse FOMC clusters → then cap to next 10
const collapsed = collapseFomcSameDay(filtered);
const top = collapsed.slice(0, 10);
setEconEvents(top);

try { localStorage.setItem("fredEventsCacheV1", JSON.stringify(top)); } catch {}
    try { localStorage.setItem("fredEventsCacheV1", JSON.stringify(events)); } catch {}
    console.log("[FRED] set", events.length, "events — unique titles:", Array.from(new Set(events.map(e => e.title))));
  } catch (e) {
    addDebug("fetchUpcomingMacro FRED error", e);
    setEconEvents([]);
  }
}

  async function fetchNewsAndEvents(symbol: string) {
    const tkr = symbol.toUpperCase().trim();


// Headlines: Polygon → Finnhub fallback, then impact sort (via Netlify proxies)
try {
  let list: Headline[] = [];

  // 1) Polygon via proxy
  try {
    const j = await poly(`/v2/reference/news?ticker=${encodeURIComponent(tkr)}&limit=30`);
    const arr = Array.isArray((j as any)?.results) ? (j as any).results : [];
    list = arr
      .map((n: any) => ({
        title: n?.title ?? "",
        source: n?.publisher?.name ?? n?.publisher ?? "",
        url: n?.article_url ?? n?.url ?? "",
        ts: n?.published_utc ? Date.parse(n.published_utc) : undefined,
      }))
      .filter((h) => h.title);
  } catch (err) {
    addDebug("polygon news via proxy failed", err);
  }

  // 2) Finnhub fallback via proxy
  if (!list.length) {
    const from = toYMD_UTC(new Date(Date.now() - 5 * 86_400_000));
    const to = toYMD_UTC(new Date());
    const j2 = await finnhub(`/company-news?symbol=${encodeURIComponent(tkr)}&from=${from}&to=${to}`);
    const arr2 = Array.isArray(j2) ? j2 : [];
    list = arr2
      .map((n: any) => ({
        title: n?.headline ?? n?.title ?? "",
        source: n?.source ?? "",
        url: n?.url ?? "",
        ts: n?.datetime ? n.datetime * 1000 : undefined,
      }))
      .filter((h) => h.title);
  }

  const scored = list.map((h) => ({ h, s: scoreHeadline(h, tkr) }));
  scored.sort((a, b) => b.s - a.s || (b.h.ts || 0) - (a.h.ts || 0));
  setHeadlines(scored.map((x) => x.h).slice(0, 10));
} catch (e) {
  addDebug("fetchNews (headlines) error", e);
  setHeadlines([]);
}
  }


  // -----------------------------
  // INPUT + EFFECTS
  // -----------------------------
const onChange = (e: any) => {
  const { name } = e.target;
  let { value } = e.target;

  if (name === "ticker") value = value.toUpperCase().replaceAll(" ", "");
  if (name === "strike") strikeTouchedRef.current = true;
  if (name === "ticker" || name === "type") strikeTouchedRef.current = false;

  // ---- Debounced: normalize pricePaid after user pauses typing ----
if (name === "pricePaid") {
  // Allow raw editing while typing
  setForm((f) => ({ ...f, pricePaid: value }));

  // Hide previous results (same behavior as ticker/type edits)
  setSubmitted(false);
  setRoutes(null);

  // reset debounce
  if (pricePaidDeb.current) window.clearTimeout(pricePaidDeb.current);
  pricePaidDeb.current = window.setTimeout(() => {
    // Use current mark as a hint when scaling 2800 -> 28.00, etc.
    const mk = Number(quote?.mark);
    const refMark = Number.isFinite(mk) && mk > 0 ? mk : undefined;

    // normalizePaid already handles 2800 → 28.00 etc.
    let n = normalizePaid(value, refMark);

    // If user typed only digits with no dot (e.g., "45"),
    // treat it as cents → 0.45 (also "120" → 1.20)
    if (/^\d+$/.test(String(value)) && !String(value).includes(".") && Number(value) <= 999) {
      n = Number(value) / 100;
    }

    if (n != null && Number.isFinite(n)) {
      setForm((f) => ({ ...f, pricePaid: n.toFixed(2) }));
    }
  }, 1738) as unknown as number;

  return; // prevent the generic setForm below from firing again
}

setForm((f) => {
  if (name === "ticker") {
    const t = String(value || "").toUpperCase().trim();
    return { ...f, ticker: t, spot: "", strike: "" }; // clear stale spot + strike
  }
  if (name === "type")   return { ...f, type: value,   strike: "" };
  if (name === "expiry") return { ...f, expiry: value };
  return { ...f, [name]: value };
});


if (name === "ticker" || name === "type" || name === "expiry") {
  if (name === "ticker" || name === "type") {
    setAllStrikes([]);
    setStrikes([]);
  }
  setGreeks({
    delta: "—",
    gamma: "—",
    theta: "—",
    vega: "—",
    iv: "—",
    openInterest: "—",
  });
  setPolyStatus("—");
  setMatchedContract("");
  setInsights({ score: 0, advice: [], explainers: [] });
  setLlmStatus("");
  setHeadlines([]);
  //setEconEvents([]);
  setEarnings(null);
}
setSubmitted(false);
};
// Populate macro (FOMC/CPI/etc.) on app load + refresh every 6h
useEffect(() => {
  fetchUpcomingMacro().catch(e => addDebug("macro mount error", e));
  const id = setInterval(() => {
    fetchUpcomingMacro().catch(e => addDebug("macro refresh error", e));
  }, 6 * 60 * 60 * 1000); // 6 hours
  return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

   // >>> add this watcher right here <<<
useEffect(() => {
  console.log("[DEBUG] econEvents length =", econEvents.length, econEvents.slice(0, 5));
}, [econEvents]);
// <<< end watcher >>>
  // Expirations when ticker changes
  useEffect(() => {
    if (!form.ticker.trim()) return;
    loadExpirations(form.ticker).catch((e) => addDebug("Expirations effect error", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.ticker]);

// Reset dependent fields when ticker changes, then load expirations (canonical)
useEffect(() => {
  if (!form.ticker || !form.ticker.trim()) return;

  console.log("[WATCH ticker→expirations]", { t: form.ticker });

  // Hard reset cross-ticker state so nothing bleeds
  setForm((f) => ({ ...f, expiry: "", strike: "" }));
  setExpirations([]);
  setAllStrikes([]);
  setStrikes([]);

  // Kick off fresh expirations for this ticker
  loadExpirations(form.ticker).catch((e) => {
    console.warn("[WATCH ticker→expirations] error", e);
    try { addDebug?.("Expiries effect error", e); } catch {}
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [form.ticker]);
// When the user picks CALL/PUT, load expirations, auto-pick nearest,
// then immediately load strikes for that picked expiry.
useEffect(() => {
  if (!form.ticker?.trim() || !form.type) return;

  console.log("[PRIME] type set — fetching expirations and strikes", {
    t: form.ticker, type: form.type
  });

  (async () => {
    // 1) fetch expirations (loadExpirations now returns the list)
    const exps = await loadExpirations(form.ticker);
    if (!Array.isArray(exps) || exps.length === 0) return;

    // 2) pick nearest date; set it if changed
    const auto = pickNearestExpiry(exps); // you already have this helper
    const effExpiry = auto || form.expiry || "";
    if (effExpiry && effExpiry !== form.expiry) {
      setForm((f) => ({ ...f, expiry: effExpiry }));
    }

    // 3) immediately load strikes for that expiry
    if (effExpiry) {
      await loadStrikesForExpiry(
        form.ticker,
        form.type as "CALL" | "PUT",
        effExpiry
      );
    }
  })().catch((e) => addDebug("Prime type→exp+strikes error", e));

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [form.ticker, form.type]);

// Strikes when ticker/type/expiry change (per-expiry only)
useEffect(() => {
  if (!form.ticker.trim() || !form.type || !form.expiry) return;

  console.log("[WATCH strikes]", {
    t: form.ticker,
    type: form.type,
    exp: form.expiry
  });

  loadStrikesForExpiry(
    form.ticker,
    form.type as "CALL" | "PUT",
    form.expiry
  ).catch((e) => addDebug("Strikes effect error", e));

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [form.ticker, form.type, form.expiry]);
// Re-center strikes whenever the raw list or spot/current changes
useEffect(() => {
  if (!allStrikes.length) return;

  const spotNum =
    form.spot !== "" && Number.isFinite(Number(form.spot)) && Number(form.spot) > 0
      ? Number(form.spot)
      : null;

  const curr =
    Number.isFinite(Number(form.strike)) && Number(form.strike) > 0
      ? Number(form.strike)
      : null;

  let view = showAllStrikes
    ? [...allStrikes]
    : filterStrikesForView({
        spot: spotNum,
        all: allStrikes,
        current: curr,
        eachSide: STRIKES_EACH_SIDE,
      });

  if (!Array.isArray(view) || view.length === 0) view = [...allStrikes];
  if (curr != null && !view.includes(curr)) view.push(curr);

  setStrikes([...new Set(view)].sort((a, b) => a - b));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [allStrikes, form.spot, form.strike, showAllStrikes]);

// Auto-select closest strike to live spot whenever spot or the full per-expiry list changes,
// unless the user has manually chosen a strike.
useEffect(() => {
  if (!Array.isArray(allStrikes) || allStrikes.length === 0) return;

  const s = Number(form.spot);
  if (!Number.isFinite(s)) return;

  // compute closest from the complete per-expiry list (more robust than a window)
  const closest = allStrikes.reduce(
    (prev, curr) => (Math.abs(curr - s) < Math.abs(prev - s) ? curr : prev),
    allStrikes[0]
  );

  const current = Number(form.strike);
  const needsUpdate = !Number.isFinite(current) || Math.abs(current - closest) > 1e-9;

  if (needsUpdate && !strikeTouchedRef.current) {
    setForm((f) => ({ ...f, strike: String(closest) }));
  }
}, [allStrikes, form.spot, form.ticker, form.type]);


  // Spot polling (10s)
  useEffect(() => {
    if (!form.ticker.trim()) return;
    let id: number | null = null;
    loadSpot(form.ticker).catch((e) => addDebug("Initial spot error", e));
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() < spotCooldownUntil.current) return;
      loadSpot(form.ticker, { silent: true }).catch((e) => addDebug("Spot poll error", e));
    };
    id = window.setInterval(tick, 10000);
    return () => {
      if (id) window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.ticker]);


  // Submit handler: fetch everything once and analyze (min 6s overlay)
  async function handleSubmit() {
    if (!form.ticker || !form.type || !form.expiry || !form.strike) return;
    setSubmitted(true);
    setOverlayOpen(true);


    try {
      const typeLower = (form.type === "CALL" ? "call" : "put") as "call" | "put";


      const snap = await loadPolygonGreeks(form.ticker, form.expiry, typeLower, form.strike);
      console.log("[CUSHION] snap.quoteNum:", snap?.quoteNum); // <— add this one line
      // TEMP: log and wire greeks from the loader
console.log("[GREEKS RAW]", snap?.numericGreeks);

const g = snap?.numericGreeks;
setGreeks({
  delta: Number.isFinite(g?.delta as any) ? (g!.delta as number).toFixed(4) : "—",
  gamma: Number.isFinite(g?.gamma as any) ? (g!.gamma as number).toFixed(4) : "—",
  theta: Number.isFinite(g?.theta as any) ? (g!.theta as number).toFixed(4) : "—",
  vega:  Number.isFinite(g?.vega  as any) ? (g!.vega  as number).toFixed(2) : "—",
  iv:    Number.isFinite(g?.iv    as any) ? ((g!.iv as number) * 100).toFixed(1) + "%" : "—",
  openInterest: Number.isFinite(g?.openInterest as any)
    ? String(Math.round(g!.openInterest as number))
    : "—",
});
      if (snap?.quoteNum) {
  setQuote({
    bid: snap.quoteNum.bid?.toFixed(2) ?? "—",
    ask: snap.quoteNum.ask?.toFixed(2) ?? "—",
    last: snap.quoteNum.last?.toFixed(2) ?? "—",
    mark: snap.quoteNum.mark?.toFixed(2) ?? "—",
    src: "Tradier",
  });
}
console.log("[QUOTE UI STATE]", snap?.quoteNum, "→", { bid: snap?.quoteNum?.bid?.toFixed?.(2), ask: snap?.quoteNum?.ask?.toFixed?.(2), last: snap?.quoteNum?.last?.toFixed?.(2), mark: snap?.quoteNum?.mark?.toFixed?.(2) });

      await Promise.all([fetchNewsAndEvents(form.ticker), fetchEarnings(form.ticker)]);


await analyzeWithAI({
  greeksOverride: snap?.numericGreeks ?? undefined,
  contractOverride: snap?.contract,
  quoteOverride: snap?.quoteNum, // <-- this is the new part
});


      await sleep(6000);
    } catch (e) {
      addDebug("handleSubmit error", e);
    } finally {
      setOverlayOpen(false);
    }
  }
  // -----------------------------
  // DERIVED METRICS (UI)
  // -----------------------------
  const daysToExpiry = form.expiry
    ? Math.max(
        0,
        Math.ceil(
          (new Date(form.expiry + "T00:00:00Z").getTime() - Date.now()) / 86_400_000
        )
      )
    : 0;
  const k = num(form.strike);
  const spotNum = num(form.spot);
 const mk = Number(quote?.mark);
const refMark = Number.isFinite(mk) && mk > 0 ? mk : undefined;
const paid = getPaidNormalized(form.pricePaid, refMark) ?? NaN;
  const openNum = num(form.open);
const pctDay =
  Number.isFinite(openNum) && Number.isFinite(spotNum) && openNum !== 0
    ? ((spotNum - openNum) / openNum) * 100
    : NaN;
  const isCall = form.type === "CALL";
  const breakeven =
    Number.isFinite(k) && Number.isFinite(paid) ? (isCall ? k + paid : k - paid) : NaN;


const parsed = {
  strike: Number.isFinite(k) ? k : NaN,
  spot: Number.isFinite(spotNum) ? spotNum : NaN,
  open: Number.isFinite(openNum) ? openNum : NaN,
  pctDay: Number.isFinite(pctDay) ? pctDay : NaN,
  breakeven,
};


  const showBreakeven =
    form.pricePaid.trim() !== "" && Number.isFinite(parsed.breakeven);


const ivPctUI =
  greeks.iv && greeks.iv !== "—" ? Number(String(greeks.iv).replace("%", "")) : null;

const ruleFallbackUI = computeRuleRiskScore({
  dte: daysToExpiry,
  ivPct: ivPctUI,
  distance_otm_pct: Number.isFinite(parsed.spot) && Number.isFinite(parsed.strike)
    ? ((parsed.spot - parsed.strike) / parsed.strike) * 100 // signed, same shape your builder uses
    : null,
  oi: greeks.openInterest && greeks.openInterest !== "—" ? Number(greeks.openInterest) : null,
  breakeven_gap_pct: Number.isFinite(parsed.breakeven) && Number.isFinite(parsed.spot)
    ? ((parsed.breakeven - parsed.spot) / parsed.spot) * 100
    : null,
});

const rawScore =
  Number.isFinite(insights.score) ? Number(insights.score) : ruleFallbackUI;
const displayScore = Math.max(0, Math.min(10, rawScore));
  const { bucket: riskBucket, color: riskColor } = riskFromScore(displayScore);
// DTE color (simple & safe)
const dteColor =
  !Number.isFinite(daysToExpiry as any) ? "text-neutral-400"
  : (daysToExpiry as number) <= 2  ? "text-rose-400"
  : (daysToExpiry as number) <= 7  ? "text-amber-400"
  : (daysToExpiry as number) <= 21 ? "text-yellow-400"
  : "text-green-400";

  // -----------------------------
  // Autocomplete state (FIXED)
  // -----------------------------
  const [tickerQuery, setTickerQuery] = useState("");
  const [tickerOpts, setTickerOpts] = useState<
    Array<{ symbol: string; name?: string }>
  >([]);
  const [tickerOpen, setTickerOpen] = useState(false);
  const [tickerIdx, setTickerIdx] = useState(-1);
  const searchAbort = useRef<AbortController | null>(null);
  const debTimer = useRef<number | null>(null);
  const pricePaidDeb = useRef<number | null>(null);
  const searchSeq = useRef(0);




// - For any query, only symbols that START WITH the typed text are shown.
// - We still hide .U/.WS/etc unless the user types a dot.
// - If there are zero matches and the query is long (>=4), we allow a
//   soft fallback of "contains" so the user isn't stuck completely empty.
function rankAndDedupSymbols(
  list: Array<{ symbol: string; name?: string }>,
  q: string
) {
  const U = q.toUpperCase();
  const hasDot = U.includes(".");


  const hideUnitLike = (sym: string) =>
    !hasDot && /\.(U|WS|W|R|P|A|B|C)(\.|$)?$/i.test(sym);


  // Unique by symbol
  const map = new Map<string, { symbol: string; name?: string }>();
  for (const item of list) if (!map.has(item.symbol)) map.set(item.symbol, item);
  const arr = Array.from(map.values()).filter((x) => !hideUnitLike(x.symbol));


  // STRICT: prefix-only filter on the ticker symbol
  let out = arr.filter((x) => x.symbol.toUpperCase().startsWith(U));


  // Soft fallback only if nothing matches and query is long
  if (out.length === 0 && U.length >= 4) {
    out = arr.filter((x) => x.symbol.toUpperCase().includes(U));
  }


  // Rank: exact match → shorter symbols → alpha
  out.sort((a, b) => {
    const A = a.symbol.toUpperCase();
    const B = b.symbol.toUpperCase();
    const ra = A === U ? 0 : 1;
    const rb = B === U ? 0 : 1;
    if (ra !== rb) return ra - rb;
    if (a.symbol.length !== b.symbol.length) return a.symbol.length - b.symbol.length;
    return A.localeCompare(B);
  });


  return out.slice(0, 20);
}


// Debounced Polygon ticker search (exact + prefix + fuzzy, race guarded, 1-char friendly)
useEffect(() => {
  const q = tickerQuery.trim().toUpperCase();

  // clear prior timer
  if (debTimer.current) window.clearTimeout(debTimer.current);

  // if empty, clear UI and bail
  if (!q) {
    setTickerOpts([]);
    setTickerOpen(false);
    setTickerIdx?.(-1);
    return;
  }

  debTimer.current = window.setTimeout(async () => {
    const mySeq = ++searchSeq.current;
    try {
      // abort any in-flight search
      if (searchAbort.current) searchAbort.current.abort();
      const ctrl = new AbortController();
      searchAbort.current = ctrl;

      // --- Build 3 Polygon paths ---
      // 1) Exact ticker — super fast
      const exactPath =
        `/v3/reference/tickers` +
        `?ticker=${encodeURIComponent(q)}` +
        `&market=stocks&active=true&limit=1`;

      // 2) Prefix range — great for 1-letter queries
      const prefixPath =
        `/v3/reference/tickers` +
        `?market=stocks&active=true` +
        `&ticker.gte=${encodeURIComponent(q)}` +
        `&ticker.lte=${encodeURIComponent(q + "ZZZZZZ")}` +
        `&sort=ticker&order=asc&limit=100`;

      // 3) Fuzzy — only if 2+ chars
      const fuzzyPath = q.length >= 2
        ? `/v3/reference/tickers?market=stocks&active=true&search=${encodeURIComponent(q)}&limit=50`
        : null;

      const fnURL = (p: string) => `/.netlify/functions/polygon-proxy?path=${encodeURIComponent(p)}`;

      const promises: Promise<Response>[] = [
        fetch(fnURL(exactPath),  { signal: ctrl.signal }),
        fetch(fnURL(prefixPath), { signal: ctrl.signal }),
      ];
      if (fuzzyPath) promises.push(fetch(fnURL(fuzzyPath), { signal: ctrl.signal }));

      const settled = await Promise.allSettled(promises);

      let raw: Array<{ symbol: string; name?: string }> = [];
      const pushFrom = async (s: PromiseSettledResult<Response> | undefined) => {
        if (!s || s.status !== "fulfilled") return;
        const r = s.value;
        if (!r.ok) return;
        const j: any = await r.json();
        const arr = Array.isArray(j?.results) ? j.results : [];
        for (const x of arr) {
          if (x && typeof x.ticker === "string") {
            raw.push({ symbol: x.ticker, name: typeof x.name === "string" ? x.name : undefined });
          }
        }
      };

      await Promise.all([pushFrom(settled[0]), pushFrom(settled[1]), pushFrom(settled[2])]);

      // simple dedupe if your ranker isn’t present
      const dedup = Array.from(new Map(raw.map(o => [o.symbol, o])).values());
      const ranked = typeof rankAndDedupSymbols === "function" ? rankAndDedupSymbols(dedup, q) : dedup;

      // race guard
      if (mySeq !== searchSeq.current) return;

const opts = ranked.map(o => ({
  value: o.symbol,
  symbol: o.symbol,
  name: o.name,
  label: o.name ? `${o.symbol} — ${o.name}` : o.symbol,
}));

      setTickerOpts(opts);
      setTickerOpen(opts.length > 0);
      setTickerIdx(opts.length ? 0 : -1);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      if (mySeq !== searchSeq.current) return;
      setTickerOpts([]);
      setTickerOpen(false);
      setTickerIdx?.(-1);
    }
  }, 150) as unknown as number;

  return () => {
    if (debTimer.current) window.clearTimeout(debTimer.current);
  };
}, [tickerQuery]);


// Hide/reset results while the user is typing a *different* ticker (before they pick)
// (kept as-is from your snippet)
useEffect(() => {
  const q = tickerQuery.trim().toUpperCase();
  const chosen = form.ticker.trim().toUpperCase();

  if (submitted && q && q !== chosen) {
    // hide the results panel right away
    setSubmitted(false);

    // optional: quick clear so stale data doesn't flash
    // (comment out any lines you don't have setters for)
    setPolyStatus?.("—");
    setMatchedContract?.("");
    setGreeks?.({ delta:"—", gamma:"—", theta:"—", vega:"—", iv:"—", openInterest:"—" });
    setInsights?.({ score: 0, advice: [], explainers: [] });
    setLlmStatus?.("");
    setHeadlines?.([]);
    setEconEvents?.([]);
    setEarnings?.(null);
  }
}, [tickerQuery, form.ticker, submitted]);




  const isDisabled =
    !form.ticker || !form.type || !form.expiry || !form.strike || loadingExp || loadingStrikes;

function renderTLDR() {
  // reuse values you already compute in v1.03
  const iv = ivPctUI; // number | null (e.g., 68)
  const beGapPct =
    Number.isFinite(parsed.breakeven) && Number.isFinite(parsed.spot)
      ? (((parsed.breakeven as number) - (parsed.spot as number)) / (parsed.spot as number)) * 100
      : NaN;

  // POP if we have IV or delta (uses your existing helper)
  const pop = probITM({
    spot: Number(parsed.spot),
    strike: Number(parsed.strike),
    isCall,
    ivPct: Number.isFinite(iv) ? (iv as number) : null,
    dte: daysToExpiry,
  });

  // pick the nearest macro (same logic style you use elsewhere)
  const nearMacro = (econEvents || []).find((e) => {
    const md = new Date(e.date + "T00:00:00Z").getTime();
    const d = Math.floor((md - Date.now()) / 86_400_000);
    return d >= 0 && d <= 7;
  });

  const bits: React.ReactNode[] = [];

  // opener by risk bucket
  const opener =
    riskBucket === "Very High" ? "Lotto-like risk" :
    riskBucket === "High"      ? "High risk" :
    riskBucket === "Moderate"  ? "Manageable risk" :
                                 "Low risk";
  bits.push(<span key="o" className={`${riskColor} font-semibold`}>{opener}</span>);

  // time pressure
  if (daysToExpiry <= 10) bits.push(<span key="t"> — short DTE; theta will bite.</span>);

  // IV flavor
  if (Number.isFinite(iv) && (iv as number) >= 60) {
    bits.push(<span key="iv"> IV is rich; crush risk if the catalyst passes.</span>);
  } else if (Number.isFinite(iv) && (iv as number) <= 25) {
    bits.push(<span key="ivl"> IV is cheap; price move matters more.</span>);
  }

  // breakeven nudge
  if (Number.isFinite(beGapPct) && (beGapPct as number) > 10) {
    bits.push(<span key="be"> Needs ~{(beGapPct as number).toFixed(1)}% just to breakeven.</span>);
  }

  // event awareness
  if (earnings?.date) {
    const now = Date.now();
    const ed = new Date(earnings.date + "T00:00:00Z").getTime();
    const d  = Math.floor((ed - now) / 86_400_000);
    const when = d <= 0 ? "today" : `in ${d}d`;
    bits.push(<span key="er"> Earnings {when}; expect IV swing.</span>);
  } else if (nearMacro) {
    bits.push(<span key="m"> {nearMacro.title} this week; index-wide vol possible.</span>);
  }

  // POP if available
  if (Number.isFinite(pop as any)) {
    bits.push(<span key="p"> POP ~{pop}% ITM.</span>);
  }

  return <>{bits}</>;
}

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="min-h-screen bg-black text-neutral-200">
      <Starfield />


 {/* Top hero (switches after submit) */}
<div className="max-w-5xl mx-auto px-4 pt-16 pb-6 text-center relative z-10">
  {submitted ? (
    <>
      <h1 className="text-4xl md:text-6xl font-semibold leading-tight">
        The Results....👀
      </h1>

      {/* three chevrons pointing down */}
      <div className="mt-3 flex items-center justify-center gap-6" aria-hidden="true">
        <svg
          className="w-8 h-8 animate-bounce text-indigo-400/90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <svg
          className="w-8 h-8 animate-bounce [animation-delay:150ms] text-indigo-400/90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        <svg
          className="w-8 h-8 animate-bounce [animation-delay:300ms] text-indigo-400/90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </>
  ) : (
    <>
      <h1 className="text-4xl md:text-6xl font-semibold leading-tight">
        Options are risky — but how risky is yours?
      </h1>
      <p className="mt-4 text-neutral-400">Enter your trade and find out in seconds.</p>
      <svg
        className="mx-auto mt-4 w-8 h-8 animate-bounce text-indigo-400/90"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 5v12" />
        <path d="M6 11l6 6 6-6" />
      </svg>
    </>
  )}
</div>


{/* Input card */}
{!submitted && (
  <div className={`max-w-5xl mx-auto px-4 pb-10 ${submitted ? "hidden" : ""}`}>
    <div className="form-card rounded-xl p-3 md:p-4 shadow-xl bg-neutral-950/70 border border-neutral-800">
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
<TickerAutocomplete
  label="Ticker"
  value={form.ticker}
  query={tickerQuery}
  setQuery={setTickerQuery}
  options={tickerOpts}
  open={tickerOpen}
  setOpen={setTickerOpen}
  activeIdx={tickerIdx}
  setActiveIdx={setTickerIdx}
  onPick={(sym) => {
    // user chose a symbol from the list
    strikeTouchedRef.current = false;

    setForm((f) => ({ ...f, ticker: sym.toUpperCase(), strike: "" }));
    setTickerQuery(sym.toUpperCase());
    setTickerOpen(false);

    // Hide previous results immediately and prep for fresh run
    setSubmitted(false);
  }}
/>
        <Select
          label="Option Type"
          name="type"
          value={form.type}
          onChange={onChange}
          options={["", "CALL", "PUT"]}
          className="solid-input"
        />
        <Select
          label={`Strike${loadingStrikes ? " (loading…)" : ""}`}
          name="strike"
          value={form.strike}
          onChange={onChange}
          options={strikes.length ? ["", ...strikes.map((n) => String(n))] : [""]}
          className="solid-input"
        />
        <Select
          label={`Expiration${loadingExp ? " (loading…)" : ""}`}
          name="expiry"
          value={form.expiry}
          onChange={onChange}
          options={expirations.length ? ["", ...expirations] : [""]}
          className="solid-input"
          renderAsDate
        />
        <Input
          label="Price Paid (optional)"
          name="pricePaid"
          type="number"
          value={form.pricePaid}
          onChange={onChange}
          placeholder="1.00, 2.10 etc"
          min="0"
          step="0.01"
          className="solid-input"
        />
        <label className="flex flex-col text-sm md:self-end">
          <span className="invisible mb-1">Submit</span>
          <span
            className="block"
            title={isDisabled ? "Please fill in inputs with valid data" : undefined}
          >
            <button
              onClick={handleSubmit}
              disabled={isDisabled}
              className={`h-12 rounded-xl font-medium w-full ${
                isDisabled ? "bg-neutral-800 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-500"
              }`}
            >
              {loadingExp || loadingStrikes ? "Please wait…" : "Submit"}
            </button>
          </span>
        </label>
      </div>
    </div>
  </div>
)}
{submitted && !isGenLoading && (
<div className="flex justify-center mb-6">
  <button
    onClick={resetToHome}
    className="inline-flex items-center gap-2 rounded-xl border border-purple-500 bg-neutral-900/70 backdrop-blur px-4 py-2 text-sm text-purple-300 hover:bg-purple-500/10 hover:shadow-[0_0_10px_rgba(168,85,247,0.6)] active:scale-[0.99] transition"
    title="Clear and start a fresh check"
    aria-label="Try another contract"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.25}
        d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
    Try another contract
  </button>
</div>
)}
{!submitted && (
  <div className="text-center text-neutral-600 text-xs pb-10 relative z-10">
    <div className="inline-flex items-center gap-2">
      <span>v1.2</span>
      <span className="text-neutral-700">•</span>
      <span>Powered by AI</span>
      <span className="text-neutral-700">•</span>

      <details className="inline-block">
        <summary className="inline-flex items-center gap-1 cursor-pointer text-neutral-400 hover:text-neutral-300 list-none">
          Patch Notes
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </summary>

        <div className="mt-3 text-left rounded-2xl border border-neutral-800 bg-neutral-900/60 backdrop-blur p-4 shadow-xl">
          <div className="space-y-3">
            <div>
              <div className="text-[11px] text-neutral-500 uppercase tracking-widest">2025-09-05 — UI</div>
              <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-neutral-300">
                <li>Added “Try another contract” under Inputs</li>
                <li>Adjusted strike loading logic for better accuracy</li>
              </ul>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500 uppercase tracking-widest">2025-09-04 — Results polish</div>
              <ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-neutral-300">
                <li>Colored borders on analysis</li>
                <li>Tweaked AI logic</li>
              </ul>
            </div>
          </div>
        </div>
      </details>

      <span className="text-neutral-700">•</span>
      <span>Data You Enter Is Not Saved</span>
    </div>
  </div>
)}
      {/* Results */}
      {submitted && (
        <div className="relative z-10 max-w-5xl mx-auto px-4 pb-20">
          {/* HEADER CARD (title + score) */}
          <div className="form-card rounded-2xl p-5 md:p-6 mb-4 bg-neutral-950/70 border border-neutral-800">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="text-xl md:text-2xl font-semibold tracking-tight">
                  {form.ticker.toUpperCase()} {form.type} {fmtStrike(parsed.strike)} •{" "}
                  {displayMDY(form.expiry)}
                </div>
<div className="text-neutral-400 text-sm mt-1">
  <span className="mr-1">Spot</span>
  <span className="text-neutral-100 font-medium">
    {spotLoading ? "—" : fmt(parsed.spot)}
  </span>
  {Number.isFinite(parsed.pctDay) && (
    <span
      className={`ml-2 ${
        parsed.pctDay > 0
          ? "text-green-400"
          : parsed.pctDay < 0
          ? "text-rose-400"
          : "text-neutral-400"
      }`}
      title={Number.isFinite(parsed.open) ? `Open ${fmt(parsed.open)}` : undefined}
    >
      {parsed.pctDay >= 0 ? "+" : ""}
      {parsed.pctDay.toFixed(2)}%
    </span>
  )}
  {showBreakeven && <> • Breakeven {fmt(parsed.breakeven)}</>}
  {" "}• DTE{" "}
<span className={dteColor}
      title={
        Number.isFinite(daysToExpiry as any)
          ? (daysToExpiry as number) <= 2 ? "Very short (≤2d)"
          : (daysToExpiry as number) <= 7 ? "Short (≤1w)"
          : (daysToExpiry as number) <= 21 ? "Medium (≤3w)"
          : "Long (>3w)"
          : undefined
      }>
  {Number.isFinite(daysToExpiry as any) ? `${daysToExpiry}` : "—"}
</span>
</div>
{/* Live option quote (from proxy) */}
<div className="text-neutral-400 text-xs mt-1">
  <span className="mr-2">Bid <span className="text-neutral-100 font-medium">{quote.bid}</span></span>
  <span className="mr-2">Ask <span className="text-neutral-100 font-medium">{quote.ask}</span></span>
  <span className="mr-2">Mark <span className="text-neutral-100 font-medium">{quote.mark}</span></span>
</div>
{/* P/L vs Price Paid */}
{(() => {
  const mk = Number(quote.mark);
  const hasMk = Number.isFinite(mk) && mk > 0;
  const paid = normalizePaid(form.pricePaid, hasMk ? mk : undefined);
  const hasPaid = Number.isFinite(paid as any) && (paid as number) > 0;

  if (!hasPaid || !hasMk) return null;

  const pnl = (mk - (paid as number)) * 100;            // per contract ($)
  const pnlPct = ((mk - (paid as number)) / (paid as number)) * 100;

  const tone =
    pnlPct >= 20 ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
  : pnlPct >= 0  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
  : pnlPct <= -40? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
  :                "bg-rose-500/10 text-rose-300 border border-rose-500/20";

  return (
    <div className="mt-1 text-xs">
      <span className={`px-2 py-0.5 rounded ${tone}`}>
        P/L {pnl >= 0 ? "+" : ""}${pnl.toFixed(0)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
      </span>
      <span className="ml-2 text-neutral-500">
        (Paid ${(paid as number).toFixed(2)} → Mark {quote.mark})
      </span>
    </div>
  );
})()}
              </div>
              <div className="text-right">
                <div className={`text-4xl md:text-5xl font-semibold ${riskColor}`}>
                  {displayScore.toFixed(1)}
                  <span className="text-neutral-400 text-2xl">/10</span>
                </div>
                <div className={`uppercase tracking-widest text-xs mt-1 ${riskColor}`}>
                  {riskBucket}
                </div>
                <WhyScoreTooltip items={insights.explainers} />
              </div>
            </div>          
          </div>


          {/* SUMMARY */}
<MiniCard
  title={insights.headline ? "Let's take a deeper look — " + insights.headline : "Summary"}
  className="md:col-span-2 mb-4"
>
  <div className="space-y-3 text-sm leading-relaxed text-neutral-200">
    {/* Narrative (AI) */}
    <div className="whitespace-pre-wrap">
      {insights.narrative
        ? insights.narrative
        : "Pick a contract to see a plain‑English breakdown of what matters."}
    </div>

    {/* Event awareness (earnings & macro) */}
    {(() => {
      const soon: React.ReactNode[] = [];
      if (earnings?.date) {
        const now = Date.now();
        const ed = new Date(earnings.date + "T00:00:00Z").getTime();
        const days = Math.floor((ed - now) / 86_400_000);
        const label =
          days <= 0 ? `Earnings ${earnings.when ? `(${earnings.when})` : ""} today`
          : days <= 7 ? `Earnings in ${days} day(s)${earnings.when ? ` (${earnings.when})` : ""}`
          : `Earnings on ${displayMDY(earnings.date)}${earnings.when ? ` (${earnings.when})` : ""}`;
        soon.push(<Chip key="earn" tone={chipTone("warning")}>{label}</Chip>);
      }
      const nearMacro = (econEvents || []).find((e) => {
        const md = new Date(e.date + "T00:00:00Z").getTime();
        const d = Math.floor((md - Date.now()) / 86_400_000);
        return d >= 0 && d <= 7;
      });
      if (nearMacro) soon.push(<Chip key="macro" tone={chipTone("info")}>{nearMacro.title} soon</Chip>);
      return soon.length ? <div className="flex flex-wrap gap-2">{soon}</div> : null;
    })()}

    {/* Beginner mistakes / risk callouts */}
    {(() => {
      const ivPct = (() => {
        if (!greeks?.iv || greeks.iv === "—") return NaN;
        const z = Number(String(greeks.iv).replace("%", ""));
        return Number.isFinite(z) ? z : NaN;
      })();
      const chips: React.ReactNode[] = [];
      if (daysToExpiry <= 10) chips.push(<Chip key="theta" tone={chipTone("warning")}>Short DTE → Lose more $ from time decay</Chip>);
      if (Number.isFinite(ivPct) && ivPct >= 60) chips.push(<Chip key="iv" tone={chipTone("danger")}>Elevated IV → Premiums are high → IV crush risk → Lose $$$ FAST</Chip>);
      const oi = greeks?.openInterest !== "—" ? Number(greeks.openInterest) : NaN;
      if (Number.isFinite(oi) && oi < 500) chips.push(<Chip key="oi" tone={chipTone("warning")}>Thin liquidity (low OI)</Chip>);
      if (showBreakeven && Number.isFinite(parsed.breakeven) && Number.isFinite(parsed.spot)) {
        const gap = (((parsed.breakeven as number) - (parsed.spot as number)) / (parsed.spot as number)) * 100;
        if (gap > 10) chips.push(<Chip key="beFar" tone={chipTone("danger")}>Breakeven at EXP far (+{gap.toFixed(1)}%)</Chip>);
      }
      return chips.length ? <div className="flex flex-wrap gap-2">{chips}</div> : null;
    })()}

    {/* Nearby alternatives (simple, actionable) */}
    {/* What I'd do if I were you */}
     {false && (
<div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
  <div className="text-neutral-300 text-xs uppercase tracking-widest mb-2">
    
    Routes from here - (Not Financial Advice)
  </div>

  {!routes ? (
    <div className="text-neutral-400 text-sm">Running playbook…</div>
  ) : (
    <div className="space-y-3 text-sm">
      {/* Aggressive */}
      <div
  className={`p-2 rounded-lg border bg-neutral-900/50 ${
    routes.pick.route === "aggressive"
      ? "border-red-500/70 ring-1 ring-red-400/40"
      : "border-red-500/35"
  }`}
>
        <div className="text-xs text-neutral-400">{routes.routes.aggressive.label}</div>
        <div className="font-medium">{routes.routes.aggressive.action}</div>
        <div className="text-neutral-300">{routes.routes.aggressive.rationale}</div>
        {routes.routes.aggressive.guardrail && (
          <div className="text-neutral-400 text-xs mt-1">Guardrail: {routes.routes.aggressive.guardrail}</div>
        )}
      </div>

      {/* Middle */}
      <div
  className={`p-2 rounded-lg border ${
    routes.pick.route === "middle"
      ? "bg-neutral-800/70 border-orange-500/60"
      : "bg-neutral-900/40 border-orange-500/30"
  }`}
>
        <div className="text-xs text-neutral-400">{routes.routes.middle.label}</div>
        <div className="font-medium">{routes.routes.middle.action}</div>
        <div className="text-neutral-300">{routes.routes.middle.rationale}</div>
        {routes.routes.middle.guardrail && (
          <div className="text-neutral-400 text-xs mt-1">Guardrail: {routes.routes.middle.guardrail}</div>
        )}
      </div>

      {/* Conservative */}
      <div
  className={`p-2 rounded-lg border ${
    routes.pick.route === "conservative"
      ? "bg-neutral-800/70 border-green-500/60"
      : "bg-neutral-900/40 border-green-500/30"
  }`}
>
        <div className="text-xs text-neutral-400">{routes.routes.conservative.label}</div>
        <div className="font-medium">{routes.routes.conservative.action}</div>
        <div className="text-neutral-300">{routes.routes.conservative.rationale}</div>
        {routes.routes.conservative.guardrail && (
          <div className="text-neutral-400 text-xs mt-1">Guardrail: {routes.routes.conservative.guardrail}</div>
        )}
      </div>

{/* My pick */}
<div className="mt-2 p-2 rounded-lg border border-amber-400/70 bg-neutral-900/50">
  <div className="uppercase text-xs tracking-widest text-amber-300">If it was me</div>
  <div className="mt-1">
    <span className="font-medium">
      {routes.routes[routes.pick.route].action}
    </span>
    <span className="text-neutral-300"> — {routes.pick.reason}</span>
  </div>
</div>
    </div>
  )}
</div>
   )}
{plan && (
  <div className="grid gap-4 md:grid-cols-3 mb-4">
    {/* What I like */}
    <div className="rounded-2xl ring-1 ring-emerald-400/70 shadow-[0_0_20px_-10px_rgba(16,185,129,0.5)]">
      <div className="form-card rounded-2xl p-5 md:p-6 bg-neutral-950/90 backdrop-blur-sm">
        <div className="text-sm font-semibold text-neutral-200 mb-2">
          What I like about this contract
        </div>
        <ul className="list-disc pl-5 space-y-1 text-sm text-neutral-300">
          {plan.likes.map((s, i) => <li key={i}>{capFirst(s)}</li>)}
        </ul>
      </div>
    </div>

    {/* Watch-outs */}
    <div className="rounded-2xl ring-1 ring-red-400/70 shadow-[0_0_20px_-10px_rgba(245,158,11,0.55)]">
      <div className="form-card rounded-2xl p-5 md:p-6 bg-neutral-950/90 backdrop-blur-sm">
        <div className="text-sm font-semibold text-neutral-200 mb-2">What to watch out for</div>
        <ul className="list-disc pl-5 space-y-1 text-sm text-neutral-300">
          {plan.watchouts.map((s, i) => <li key={i}>{capFirst(s)}</li>)}
        </ul>
      </div>
    </div>

    {/* What I’d do */}
    <div className="rounded-2xl ring-1 ring-yellow-400/70 shadow-[0_0_22px_-10px_rgba(234,179,8,0.55)]">
      <div className="form-card rounded-2xl p-5 md:p-6 bg-neutral-950/90 backdrop-blur-sm">
        <div className="text-sm font-semibold text-neutral-200 mb-2">What I’d do (middle-risk, no prices)</div>
        <p className="text-sm text-neutral-300 leading-relaxed whitespace-pre-line">{capFirst(plan.plan)}</p>
      </div>
    </div>
  </div>
)}

{/* Save & Share */}
<div className="flex flex-wrap gap-2 pt-1">
  <button
    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs"
    onClick={() => {
      const obj = currentTradeStateToObject(form, greeks, insights, daysToExpiry);
      const url = buildShareUrl(obj);
      navigator.clipboard?.writeText(url);
      alert("COMING SOON");
    }}
  >
    Share Link
  </button>
</div>
</div>
</MiniCard>
          {/* DASH GRID: Greeks + Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* GREEKS */}
            <MiniCard title="Greeks Explained">
              <div className="space-y-3 text-sm">
                {(() => {
                  const deltaNum = greeks.delta !== "—" ? Number(greeks.delta) : NaN;
                  const thetaNum = greeks.theta !== "—" ? Number(greeks.theta) : NaN;
                  const vegaNum = greeks.vega !== "—" ? Number(greeks.vega) : NaN;
                  const oiNum =
                    greeks.openInterest !== "—" ? Number(greeks.openInterest) : NaN;
                  const ivStr = greeks.iv && greeks.iv !== "—" ? greeks.iv : null;
                  const ivPct = ivStr ? Number(ivStr.replace("%", "")) : NaN;


                  const delta$1 = Number.isFinite(deltaNum)
                    ? Math.round(deltaNum * 100)
                    : null;
                  const theta$1 = Number.isFinite(thetaNum)
                    ? Math.round(Math.abs(thetaNum) * 100)
                    : null;
                  const vega$1 = Number.isFinite(vegaNum)
                    ? Math.round(Math.abs(vegaNum) * 100)
                    : null;
                  const vega$5 = Number.isFinite(vegaNum)
                    ? Math.round(Math.abs(vegaNum) * 5 * 100)
                    : null;


                  const badgeIV = ivBadge(Number.isFinite(ivPct) ? ivPct : null);


                  const soonBits: string[] = [];
                  if (earnings?.date) {
                    const now = Date.now();
                    const ed = new Date(earnings.date + "T00:00:00Z").getTime();
                    const d = Math.floor((ed - now) / 86_400_000);
                    if (d <= 0)
                      soonBits.push(
                        `earnings ${earnings.when ? `(${earnings.when})` : ""} today`
                      );
                    else if (d <= 7) soonBits.push(`earnings in ${d} day(s)`);
                  }
                  const nearMacro = (econEvents || []).find((e) => {
                    const md = new Date(e.date + "T00:00:00Z").getTime();
                    const d = Math.floor((md - Date.now()) / 86_400_000);
                    return d >= 0 && d <= 7;
                  });
                  if (nearMacro) soonBits.push(`${nearMacro.title} soon`);


                  return (
                    <>
                      <Row
                        icon={IconDelta}
                        label="Delta"
                        value={<Badge tone={deltaBadge(deltaNum).tone}>{greeks.delta}</Badge>}
                        sub={
                          greeks.delta !== "—"
                            ? `≈ ${Math.round(Number(greeks.delta) * 100)}% stock sensitivity`
                            : "—"
                        }
                        help={
                          <InfoHover title="Delta (direction & probability)">
                            <p>
                              Delta is how much the option price changes if the stock moves $1.
                            </p>
                            {Number.isFinite(deltaNum) && delta$1 !== null ? (
                              <p className="mt-1 text-neutral-300">
                                ELI5: If the stock goes up $1, this option changes about{" "}
                                <b>${delta$1}</b> per contract.
                              </p>
                            ) : (
                              <p className="mt-1 text-neutral-300">
                                ELI5: $1 stock move ≈ Δ × $100 per contract.
                              </p>
                            )}
                          </InfoHover>
                        }
                      />
                      <Row
                        icon={IconTheta}
                        label="Theta"
                        value={<Badge tone={thetaBadge(thetaNum).tone}>{greeks.theta}</Badge>}
                        sub={
                          greeks.theta !== "—"
                            ? `≈ $${(Math.abs(Number(greeks.theta)) * 100).toFixed(0)} / day per contract`
                            : "—"
                        }
                        help={
                          <InfoHover title="Theta (time decay)">
                            <p>
                              Theta is daily time decay — how much value the option loses each day.
                            </p>
                            {Number.isFinite(thetaNum) && theta$1 !== null ? (
                              <p className="mt-1 text-neutral-300">
                                ELI5: Sleep one night → about <b>${theta$1}</b> melts from the
                                option.
                              </p>
                            ) : (
                              <p className="mt-1 text-neutral-300">
                                ELI5: Each day ≈ |θ| × $100 less per contract.
                              </p>
                            )}
                          </InfoHover>
                        }
                      />
                      <Row
                        icon={IconVega}
                        label="Vega"
                        value={<Badge tone={vegaBadge(vegaNum).tone}>{greeks.vega}</Badge>}
                        sub={
                          greeks.vega !== "—"
                            ? `≈ $${(Math.abs(Number(greeks.vega)) * 100).toFixed(0)} per 1 vol-pt move`
                            : "—"
                        }
                        help={
                          <InfoHover title="Vega (IV sensitivity)">
                            <p>
                              Vega is how much the option price shifts if implied volatility (IV)
                              changes 1 point.
                            </p>
                            {Number.isFinite(vegaNum) && vega$1 !== null ? (
                              <p className="mt-1 text-neutral-300">
                                ELI5: IV +1 → option ≈ <b>${vega$1}</b>. If IV drops 5 pts, ≈{" "}
                                <b>${vega$5}</b> the other way.
                              </p>
                            ) : (
                              <p className="mt-1 text-neutral-300">
                                ELI5: 5 IV pts × vega × $100 ≈ price change.
                              </p>
                            )}
                            {soonBits.length ? (
                              <p className="mt-1 text-neutral-400">Heads up: {soonBits.join("; ")}.</p>
                            ) : null}
                          </InfoHover>
                        }
                      />
                      <Row
                        icon={IconOI}
                        label="Open Interest"
                        value={<Badge tone={oiBadge(oiNum).tone}>{greeks.openInterest}</Badge>}
                        help={
                          <InfoHover title="Open Interest (liquidity feel)">
                            <p>
                              Open Interest is how many contracts are open. Higher OI usually means
                              easier fills and tighter spreads.
                            </p>
                            <p className="mt-1 text-neutral-300">
                              ELI5: More people at the lemonade stand → easier to buy/sell quickly.
                            </p>
                          </InfoHover>
                        }
                      />


                      <div className="border-t border-neutral-800 my-2" />
                      <Row
                        icon={IconVol}
                        label="IV"
                        value={<Badge tone={ivBadge(Number(greeks.iv.replace('%','')) || null).tone}>
                          {ivBadge(Number(greeks.iv.replace('%','')) || null).label}
                        </Badge>}
                        sub={
                          ivBadge(Number(greeks.iv.replace('%','')) || null).note === "No IV"
                            ? "—"
                            : `${ivBadge(Number(greeks.iv.replace('%','')) || null).note} premium`
                        }
                        help={
                          <InfoHover title="Implied Volatility (expected movement)">
                            <p>
                              IV is the market’s guess of future movement. It tends to rise into
                              uncertainty (earnings, CPI, FOMC) and can drop right after — the
                              “IV crush”.
                            </p>
                            {Number.isFinite(vegaNum) && vega$5 !== null ? (
                              <p className="mt-1 text-neutral-300">
                                ELI5: If IV falls 5 points and your vega is {vegaNum.toFixed(2)},
                                option moves ≈ <b>${vega$5}</b>.
                              </p>
                            ) : (
                              <p className="mt-1 text-neutral-300">
                                ELI5: 5 IV pts × vega × $100 ≈ price change.
                              </p>
                            )}
                            {soonBits.length ? (
                              <p className="mt-1 text-neutral-400">Heads up: {soonBits.join("; ")}.</p>
                            ) : null}
                          </InfoHover>
                        }
                      />
                      <div className="text-[11px] text-neutral-500">
                        {greeks.iv && greeks.iv !== "—"
                          ? "IV high ⇒ sideways = decay risk; IV drop ⇒ premium compresses."
                          : "IV not available; check your data source."}
                      </div>
                    </>
                  );
                })()}
              </div>
            </MiniCard>


          <MiniCard title="Event Radar (Next 14 Days)">
  {(() => {
    // --- helpers ---
    const safeArr = (x: any) => (Array.isArray(x) ? x : []);
    const now = new Date();
    const withinDays = 14;

const mkDate = (e: any) => {
  const t = e?.time && /^\d{2}:\d{2}$/.test(e.time) ? e.time : "12:00";
  // Local time at midday → avoids UTC off-by-one on the dots & timers
  return new Date(`${e.date}T${t}:00`);
};
    const diffDH = (d: Date) => {
      const ms = d.getTime() - now.getTime();
      const days = Math.floor(ms / 86400000);
      const hours = Math.floor((ms % 86400000) / 3600000);
      return { days, hours };
    };
    const inNextN = (e: any, n: number) => {
      const dt = mkDate(e);
      const ms = dt.getTime() - now.getTime();
      return ms >= 0 && ms <= n * 86400000;
    };
   // Impact → numeric (3=HIGH, 2=MED, 1=LOW)
const impactNum = (title: string): number => {
  const t = title.toLowerCase();
  if (t.includes("cpi") || t.includes("fomc") || t.includes("federal funds") || t.includes("press conference")) return 3;
  if (t.includes("ppi") || t.includes("retail sales") || t.includes("jobless claims")) return 2;
  return 1;
};
    const riskBadge = (title: string) => {
      const t = title.toLowerCase();
      if (t.startsWith("cpi") || t.includes("personal income") || t.includes("pce")) return ["HIGH", "bg-red-900/40 text-red-300"];
if (
  t.startsWith("fomc") ||
  t.includes("powell") ||
  t.includes("federal funds rate") ||
  t.includes("press conference") ||
  t.includes("economic projections")
) return ["HIGH", "bg-red-900/40 text-red-300"];
      if (t.includes("retail sales") || t.startsWith("ppi")) return ["MED", "bg-amber-900/40 text-amber-300"];
      if (t.startsWith("jobless") || t.includes("claims")) return ["LOW", "bg-neutral-800 text-neutral-300"];
      return ["—", "bg-neutral-800 text-neutral-400"];
    };
   // ---- Danger-window helpers ----
const daysFromNow = (isoDate: string) => {
  // Compare local midnight → local midnight to avoid UTC off-by-one
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const [y, m, d] = isoDate.split("-").map(Number);
  const eventLocalMidnight = new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
  return Math.floor((eventLocalMidnight - base) / 86_400_000);
};

const windowFor = (title: string): [number, number] => {
  const k = title.toLowerCase();
  if (k.includes("cpi")) return [-1, +1];
  if (k.includes("ppi")) return [-1, +1];
  if (k.includes("retail")) return [-1, 0];
  if (k.includes("fomc")) return [-2, +2];
  if (k.includes("powell")) return [0, 0];
  if (k.includes("jobless") || k.includes("claims")) return [0, 0];
  if (k.includes("earnings")) return [-2, +1];
  return [0, 0];
};

const buildDangerWindows = (
  events: { title: string; date: string }[],
  horizonDays = 14
): { start: number; end: number }[] => {
  const raw = events
    .map((ev) => {
      const d = daysFromNow(ev.date);
      const [pre, post] = windowFor(ev.title);
      return { start: d + pre, end: d + post };
    })
    .map((w) => ({ start: Math.max(0, w.start), end: Math.min(horizonDays, w.end) }))
    .filter((w) => w.start <= w.end);

  if (!raw.length) return [];
  raw.sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (!last || w.start > last.end + 1) merged.push({ ...w });
    else last.end = Math.max(last.end, w.end);
  }
  return merged;
};

// --- source data ---
    const macros = safeArr(econEvents);

    // risky-only filter: keep just market movers; drop claims
    const RISKY_RE =
  /(FOMC|Federal\s+Reserve|Rate\s+Decision|Federal\s+Funds\s+Rate|Press\s+Conference|Statement|Dot\s+Plot|SEP|CPI|Core\s+CPI|PCE|Core\s+PCE|PPI|Retail\s+Sales)/i;

    // Pre-compute: if we keep FOMC, prefer the actual rate-decision (Wed) when the prior day exists.
    const fomcSet = new Set(
      macros.filter((e) => /^FOMC\b/i.test(e.title)).map((e) => e.date)
    );

    const cleaned = macros
      .filter((e) => inNextN(e, withinDays))
      .filter((e) => RISKY_RE.test(e.title) && !/jobless|claims/i.test(e.title))
.filter((e) => {
  if (/fomc|federal\s+reserve/i.test(e.title)) {
    // Keep decision / presser / statement explicitly
    if (/(rate|decision|press|conference|statement|federal\s+funds\s+rate)/i.test(e.title)) return true;
// Precompute max impact for each day index 0..14 using the rows we’ll show
const dayImpact: Record<number, number> = {};
for (const e of cleaned) {
  const d = daysFromNow(e.date);
  if (d >= 0 && d <= withinDays) {
    const s = impactNum(e.title);
    dayImpact[d] = Math.max(dayImpact[d] || 0, s);
  }
}

// Map impact → Tailwind size class
const dotSize = (d: number) => {
  const lvl = dayImpact[d] || 0;
  return lvl >= 3 ? "w-4 h-4" : lvl === 2 ? "w-3 h-3" : "w-2 h-2";
};
    // Optional: still favor Wednesday (decision day) if you prefer
    const dt = new Date(`${e.date}T00:00:00Z`);
    const isWed = dt.getUTCDay() === 3;
    return isWed; // keep Wed even if Tuesday placeholder isn't present
  }
  return true;
})
      .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))
      .slice(0, 10); // cap to next 10

    const fedCount = cleaned.filter((e) =>
  /fomc|federal\s+funds\s+rate|press\s+conference|economic\s+projections|powell/i.test(e.title)
).length;
    const macroCount = cleaned.length;

    // --- timeline data ---
    const horizon = 14;
    const dayDots = Array.from({ length: horizon + 1 }, (_, i) => i);

    // Bucket events per day for hover tooltips
    const eventsByDay: Record<number, { title: string; time?: string }[]> = {};
    for (const d of dayDots) eventsByDay[d] = [];
    for (const e of cleaned) {
      const d = daysFromNow(e.date);
      if (d >= 0 && d <= horizon) {
        eventsByDay[d].push({ title: e.title, time: e.time });
      }
    }
    // Label helper: get a clean date string for a day offset (0..14)
    const dateForOffset = (offset: number) => {
      const base = new Date();
      const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
      // if you have displayMDY(YYYY-MM-DD), use it; else fallback to toLocaleDateString
      const ymd = dt.toISOString().slice(0, 10);
      try {
        // assumes you already have a displayMDY helper elsewhere in this file
        // e.g., 2025-09-08 -> "Sep 8, 2025"
        // @ts-ignore
        return displayMDY(ymd) || dt.toLocaleDateString();
      } catch {
        return dt.toLocaleDateString();
      }
    };

// Dot color by highest-risk item on that day
const colorForItems = (items: { title: string }[]) => {
  const t = (s: string) => s.toLowerCase();
  const has = (k: string) => items.some((it) => t(it.title).includes(k));

  // HIGH: CPI or any FOMC-related item
  if (has("cpi") || has("fomc") || has("federal funds") || has("press conference") || has("economic projections"))
    return "bg-red-500/70";

  // MED: PPI, Retail Sales, Jobless Claims
  if (has("ppi") || has("retail sales") || has("jobless claims"))
    return "bg-amber-500/70";

  // LOW/none
  return "bg-neutral-600";
};
// Dot size by highest-impact item on that day
const sizeForItems = (items: { title: string }[]) => {
  const t = (s: string) => s.toLowerCase();
  const has = (k: string) => items.some((it) => t(it.title).includes(k));
  if (has("cpi") || has("fomc") || has("federal funds") || has("press conference")) return "w-4 h-4"; // HIGH
  if (has("ppi") || has("retail sales") || has("jobless claims")) return "w-3 h-3";                  // MED
  return "w-2 h-2";                                                                                  // LOW/none
};
    // Danger windows (merged shaded bands)
    const dangerWindows = buildDangerWindows(
      cleaned.map((e) => ({ title: e.title, date: e.date })),
      horizon
    );

    return (
      <div className="space-y-3">
        {/* header pills (compact badges + Impact label) */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-neutral-800/80">
              Macro <span className="font-semibold">{macroCount}</span> Events
            </span>
            {fedCount > 0 && (
              <span className="px-2 py-1 rounded-full bg-emerald-900/40 text-emerald-300">
                Fed <span className="font-semibold">{fedCount}</span>
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-400 select-none">IMPACT</div>
        </div>

        {/* dotted timeline with danger bands + hoverable dots */}
        <div className="mt-1">
          <div className="relative h-10">
            {/* shaded danger bands */}
            {dangerWindows.map((w, i) => {
              const leftPct  = (w.start / horizon) * 100;
              const widthPct = ((w.end - w.start + 1) / horizon) * 100; // inclusive
              return (
                <div
                  key={`dw-${i}`}
                  className="absolute top-2 bottom-2 rounded bg-red-500/15"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              );
            })}

            {/* dashed baseline */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px border-t border-dashed border-neutral-700/70" />

{/* day dots (hover to see date + events, or “no news”) */}
<div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-2">
  {dayDots.map((d) => {
    const items = eventsByDay[d];
    const hasEvents = items && items.length > 0;
    const color = hasEvents ? colorForItems(items) : "bg-neutral-500/60";
    const dateLabel = dateForOffset(d);

    return (
      <div key={`dot-${d}`} className="relative group">
        <div
  className={`${sizeForItems(items)} rounded-full ${d === 0 ? "bg-neutral-200" : color}`}
  title={dateLabel}
  aria-label={dateLabel}
/>
        {/* unified tooltip for ALL days */}
        <div className="absolute left-1/2 -translate-x-1/2 -translate-y-full -top-2 hidden group-hover:block bg-neutral-900 text-neutral-200 text-[11px] leading-tight rounded-md shadow-xl border border-neutral-800 px-2 py-1 whitespace-nowrap z-10">
          <div className="font-medium text-neutral-100 mb-0.5">{dateLabel}</div>

          {hasEvents ? (
            <>
              {items.slice(0, 4).map((ev, j) => (
                <div key={j} className="flex gap-1 items-center">
                  <span className="opacity-60">•</span>
                  <span>{ev.title}</span>
                </div>
              ))}
              {items.length > 4 && (
                <div className="opacity-60">+{items.length - 4} more…</div>
              )}
            </>
          ) : (
            <div className="opacity-70">No major news expected</div>
          )}
        </div>
      </div>
    );
  })}
</div>

            {/* labels */}
            <div className="absolute left-0 -bottom-4 text-[10px] text-neutral-500">NOW</div>
            <div className="absolute right-0 -bottom-4 text-[10px] text-neutral-500">+14d</div>
          </div>
        </div>
{/* list */}
{(() => {
  // --- icons ---
  const iconFor = (title: string) => {
    const t = title.toLowerCase();
    const base = "w-4 h-4 shrink-0 text-neutral-300";

    // Microphone — Powell speech
    if (t.includes("powell") || t.includes("speech")) {
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M15 11V7a3 3 0 10-6 0v4a3 3 0 006 0z"/>
          <path d="M19 11a7 7 0 01-14 0"/>
          <path d="M12 18v3"/>
        </svg>
      );
    }

    // Bank — FOMC / Fed
    if (t.startsWith("fomc") || t.includes("federal funds") || t.includes("fed")) {
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 10l9-6 9 6M4 10h16"/>
          <path d="M5 10v8M9 10v8M13 10v8M19 10v8"/>
          <path d="M3 18h18"/>
        </svg>
      );
    }

    // Gauge — CPI / PCE
    if (t.startsWith("cpi") || t.includes("personal income") || t.includes("pce")) {
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 14a8 8 0 0116 0"/>
          <path d="M12 14l3-3" strokeLinecap="round"/>
          <circle cx="12" cy="14" r="1.2" fill="currentColor"/>
        </svg>
      );
    }

    // Factory — PPI
    if (t.startsWith("ppi")) {
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 20V9l6 4V9l6 4V9l6 4v7H3z"/>
          <path d="M7 15h2M11 17h2M15 15h2"/>
        </svg>
      );
    }

    // Shopping bag — Retail Sales
    if (t.includes("retail sales")) {
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 8h12l-1 12H7L6 8z"/>
          <path d="M9 8a3 3 0 016 0"/>
        </svg>
      );
    }

    // Bars — Jobless Claims
    if (t.startsWith("jobless") || t.includes("claims")) {
      return (
        <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M5 20v-3M10 20v-6M15 20v-9M20 20v-12"/>
        </svg>
      );
    }

    // fallback dot
    return <div className={`${dotSize(i)} rounded-full bg-neutral-500`} />;
  };

  if (cleaned.length) {
    return (
      <ul className="divide-y divide-neutral-800/60">
        {cleaned.map((e, i) => {
          const { days, hours } = diffDH(mkDate(e));
          const [lvl, cls] = riskBadge(e.title);
          return (
            <li key={`radar-${i}`} className="py-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {iconFor(e.title)}
                <div className="text-sm">
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-neutral-500">
                    {displayMDY(e.date)}
                    {e.time ? ` • ${e.time} ET` : ""}
                    {days >= 0 ? ` • in ${days}d${hours > 0 ? ` ${hours}h` : ""}` : ""}
                  </div>
                </div>
              </div>
              <span className={`text-[10px] px-2 py-1 rounded ${cls}`}>{lvl}</span>
            </li>
          );
        })}
      </ul>
    );
  } else {
    return <div className="text-neutral-500 text-sm">No macro events in the next 14 days.</div>;
  }
})()}
</div>
);
})()}
</MiniCard>

          </div>


          {/* NEWS & EVENTS */}
          <div className="grid grid-cols-1 md:grid-cols-1 gap-4 mt-4">
            <MiniCard title="News">
              <div className="space-y-3 text-sm">
                {/* Earnings */}
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex items-center gap-3">
                  {IconCalendarAmber}
                  <div className="leading-tight">
                    <div className="text-amber-200 font-medium">
                      {earnings ? displayMDY(earnings.date) : "No upcoming earnings found"}
                    </div>
                    <div className="text-[11px] text-amber-300/80">
                      {earnings ? (
                        <>
                          {earnings.when ? `${earnings.when}` : "Time TBA"}
                          <span
                            className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${
                              earnings.confirmed
                                ? "bg-green-500/15 text-green-300 border border-green-500/30"
                                : "bg-yellow-500/15 text-yellow-300 border border-yellow-500/30"
                            }`}
                          >
                            {earnings.confirmed ? "Confirmed" : "Estimated"}
                          </span>
                        </>
                      ) : (
                        "We’ll flag it here once it’s posted."
                      )}
                    </div>
                  </div>
                </div>


                {/* Headlines */}
<div>
  <div className="text-neutral-400 text-xs uppercase tracking-widest mb-1">
    Headlines
  </div>

  {headlines.length ? (
    <>
      {/* visible list */}
      <ul className="space-y-2">
        {headlines.slice(0, newsCount).map((n, i) => (
          <li key={`hl-${i}`} className="flex gap-2">
            <span className="mt-0.5">•</span>
            <a
              href={n.url}
              target="_blank"
              rel="noreferrer"
              className="text-neutral-200 hover:underline"
              title={n.title}
            >
              {n.title}
            </a>
            {n.source && (
              <span className="text-neutral-500 text-[11px] ml-2">
                ({n.source})
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* controls */}
      <div className="mt-2">
        {headlines.length > newsCount ? (
          <button
            type="button"
            onClick={() =>
              setNewsCount((c) => Math.min(headlines.length, c + 5))
            }
            className="text-xs text-neutral-300 hover:text-white underline"
          >
            Show more ({headlines.length - newsCount})
          </button>
        ) : headlines.length > 3 ? (
          <button
            type="button"
            onClick={() => setNewsCount(3)}
            className="text-xs text-neutral-300 hover:text-white underline"
          >
            Show less
          </button>
        ) : null}
      </div>
    </>
  ) : (
    <div className="text-neutral-500 text-xs">No recent headlines.</div>
  )}
</div>
              </div>
            </MiniCard>
          </div>
        </div>
      )}


<div className="text-center text-neutral-600 text-xs pb-10 relative z-10">
  This Tool Is In Beta - AI May Make Mistakes - Check Important Info -  Not Financial Advice
</div>

{/* Floating “Key” legend — left side */}
{submitted && !overlayOpen && (
  <div className="fixed left-3 top-1/3 z-40 hidden md:block print:hidden">
    {/* Toggle button */}
    <button
      type="button"
      aria-label="Toggle key legend"
      onClick={() => setKeyOpen((o) => !o)}
      className="mb-2 rounded-full border border-neutral-800 bg-neutral-900/80 hover:bg-neutral-800 px-3 py-1 text-xs text-neutral-300 shadow"
    >
      {keyOpen ? "Hide Key" : "Show Key"}
    </button>

    {/* Card */}
    <div
      className={[
        "w-64 rounded-xl border border-neutral-800 bg-neutral-950/75 backdrop-blur p-3 shadow-2xl",
        "transition-all duration-200",
        keyOpen ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2 pointer-events-none",
      ].join(" ")}
    >
      <div className="text-[11px] uppercase tracking-widest text-neutral-400 mb-2">
        Color Key
      </div>

      <div className="space-y-1 text-xs text-neutral-300">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
          <span>Typical / mild</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
          <span>Elevated / caution</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-400" />
          <span>High / fragile</span>
        </div>
      </div>

      <hr className="my-3 border-neutral-800" />

      <div className="text-[11px] uppercase tracking-widest text-neutral-400 mb-1">
        Greeks (rule of thumb)
      </div>
      <ul className="text-xs text-neutral-300 list-disc ml-4 space-y-1">
        <li><span className="font-medium">Δ</span> high → more directional P/L (<span className="text-rose-400">red</span>).</li>
        <li><span className="font-medium">Θ</span> high → fast decay (<span className="text-rose-400">red</span>).</li>
        <li><span className="font-medium">V</span> big → IV-sensitive; events matter (<span className="text-amber-400">amber</span>/<span className="text-rose-400">red</span>).</li>
        <li><span className="font-medium">Γ</span> near-expiry & ~ATM → snappy (<span className="text-amber-400">amber</span>/<span className="text-rose-400">red</span>).</li>
        <li><span className="font-medium">IV%</span> high → rich premium / crush risk (<span className="text-rose-400">red</span>); low → needs price move (<span className="text-green-400">green</span>).</li>
        <li><span className="font-medium">DTE</span> thresholds: ≤2d <span className="text-rose-400">red</span>, ≤7d <span className="text-amber-400">amber</span>, ≥21d <span className="text-green-400">green</span>.</li>
      </ul>
    </div>
  </div>
)}

{/* Loading Overlay */}
{overlayOpen && (
  <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
    {/* BACKGROUND LAYERS */}
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {/* A) Fast rainbow spinner number (shown first) */}
      <div
        className="font-black tracking-tight select-none"
        style={{
          position: "absolute",
          fontSize: 240,
          filter: "blur(24px)",
          opacity: showRealBg ? 0 : 0.14,                 // fade out when real arrives
          color: `hsl(${spinnerHue}, 100%, 55%)`,
          transition: "opacity 180ms ease",
          willChange: "opacity, filter",
        }}
      >
        {spinnerScore.toFixed(1)}
      </div>

      {/* B) Real AI score (fades in, EXTRA blurred) */}
      <div
        className="font-black tracking-tight select-none"
        style={{
          position: "absolute",
          fontSize: 240,
          filter: "blur(48px) saturate(1.05)",            // extra blur here
          opacity: showRealBg ? 0.18 : 0,                 // slightly stronger presence
          color: Number.isFinite(Number((insights as any)?.score))
            ? `hsl(${hueForScore(Number((insights as any)?.score))}, 100%, 55%)`
            : "transparent",
          transition: "opacity 180ms ease",
          willChange: "opacity, filter",
          textShadow: "0 0 24px rgba(0,0,0,0.35)",
    }}
      >
        {Number.isFinite(Number((insights as any)?.score))
          ? Number((insights as any).score).toFixed(1)
          : ""}
      </div>
    </div>

    {/* Your existing dialog/card */}
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/80 p-6 w-[22rem] text-center shadow-2xl">
      <LoaderSpinner />
      <div className="mt-4 text-neutral-200 font-medium">Please wait…</div>
      <div className="mt-2 text-neutral-400 text-sm">
        {overlayPlaylist[overlayStep] ?? overlayMsgs[0]}
      </div>

      {/* Tiny live line still shows the rainbow spinner (or switch to real if you prefer) */}
      <div
        className="mt-3 text-sm font-semibold select-none"
        style={{ color: `hsl(${spinnerHue}, 100%, 60%)` }}
      >
        Scoring… {spinnerScore.toFixed(1)}/10
      </div>
    </div>
  </div>
)}
    </div>
  );
}


export default function App() {
  return <TradeGaugeApp />;
}


/* =========================
   Twinkling Starfield BG
   ========================= */
function Starfield() {
  const wrapRef = useRef<HTMLDivElement>(null);

  const stars = useMemo(
    () =>
      Array.from({ length: 140 }).map(() => ({
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 0.6 + Math.random() * 1.8,
        delay: Math.random() * 5,
        opacity: Math.min(1, (0.35 + Math.random() * 0.6) * 1.3),
      })),
    []
  );

  type Shooter = { id: number; left: number; top: number; tx: number; ty: number; dur: number; ang: number };
  const [shooters, setShooters] = useState<Shooter[]>([]);

  // Edge-spawn bright yellow shooters
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    function spawn() {
      const edge = Math.floor(Math.random() * 4); // 0=L,1=R,2=T,3=B
      let left: number, top: number, tx: number, ty: number;

      if (edge === 0) { left = -2; top = 6 + Math.random() * 88; tx = 120; ty = Math.random() * 30 - 15; }
      else if (edge === 1) { left = 102; top = 6 + Math.random() * 88; tx = -120; ty = Math.random() * 30 - 15; }
      else if (edge === 2) { left = 6 + Math.random() * 88; top = -2; tx = Math.random() * 30 - 15; ty = 120; }
      else { left = 6 + Math.random() * 88; top = 102; tx = Math.random() * 30 - 15; ty = -120; }

      const ang = (Math.atan2(ty, tx) * 180) / Math.PI;
      const dur = 1.1 + Math.random() * 0.9;
      const id = Date.now() + Math.random();

      setShooters((s) => [...s, { id, left, top, tx, ty, dur, ang }]);
      window.setTimeout(() => setShooters((s) => s.filter((x) => x.id !== id)), dur * 1000 + 250);
    }

    const t0 = window.setTimeout(spawn, 700 + Math.random() * 1200);
    const iv = window.setInterval(spawn, 6000 + Math.random() * 6000);
    return () => { window.clearTimeout(t0); window.clearInterval(iv); };
  }, []);

  // Tiny parallax (pointer + tilt) for sun/stars groups
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let raf = 0;
    const setVars = (x: number, y: number) => {
      root.style.setProperty("--px", x.toFixed(3));
      root.style.setProperty("--py", y.toFixed(3));
    };

    const onPointer = (e: PointerEvent) => {
      const w = window.innerWidth || 1, h = window.innerHeight || 1;
      const x = (e.clientX / w) * 2 - 1, y = (e.clientY / h) * 2 - 1;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setVars(x, y));
    };
    const onLeave = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setVars(0, 0)); };
    const onOrient = (e: DeviceOrientationEvent) => {
      const gx = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 30));
      const gy = Math.max(-1, Math.min(1, (e.beta ?? 0) / 45));
      cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setVars(gx, gy));
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    document.addEventListener("mouseleave", onLeave);
    window.addEventListener("deviceorientation", onOrient);

    return () => {
      window.removeEventListener("pointermove", onPointer as any);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("deviceorientation", onOrient as any);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="fixed inset-0 pointer-events-none overflow-hidden -z-0"
      style={{ ["--px" as any]: 0, ["--py" as any]: 0 }}
    >
      <style>{`
  .twinkle-star {
    position: absolute;
    background: radial-gradient(circle,
      rgba(255,255,255,0.95) 0%,
      rgba(255,255,255,0.70) 40%,
      rgba(255,255,255,0.00) 70%);
    border-radius: 9999px;
    animation: tg-twinkle 4s ease-in-out infinite;
    box-shadow:
      0 0 2px rgba(255,255,255,0.60),
      0 0 6px rgba(255,255,255,0.35),
      0 0 14px rgba(255,255,255,0.22);
    filter: brightness(1.3) saturate(1.1);
    will-change: opacity, transform, filter;
  }

  @keyframes tg-twinkle {
    0%, 100% { opacity: 0.325; transform: scale(0.9); }
    50%      { opacity: 1;     transform: scale(1.05); }
  }

        /* --- SUN GLOW + RAYS (glisten) --- */
        .tg-sun-glow {
          position:absolute; inset:-20%; pointer-events:none; mix-blend-mode: screen;
          background: radial-gradient(circle at var(--sun-x, 110%) var(--sun-y, 40%),
            rgba(255,210,80,0.22), rgba(255,210,80,0.12) 15%,
            rgba(255,170,0,0.07) 28%, rgba(255,140,0,0.04) 40%,
            rgba(255,120,0,0.02) 55%, transparent 70%);
          filter: blur(18px);
        }
        .tg-sun-rays {
          position:absolute; inset:-30%; pointer-events:none; mix-blend-mode: screen;
          background: conic-gradient(from var(--sun-angle, 0deg) at var(--sun-x, 110%) var(--sun-y, 40%),
            rgba(255,220,120,0.10) 0deg, transparent 12deg,
            rgba(255,220,120,0.08) 24deg, transparent 36deg,
            rgba(255,220,120,0.06) 48deg, transparent 60deg);
          filter: blur(10px); opacity: .22; animation: tg-rays-glisten 9s ease-in-out infinite;
        }
        @property --spark-angle { syntax: '<angle>'; inherits: true; initial-value: 0deg; }
        @keyframes tg-rays-glisten {
          0%, 18% { opacity:.50; filter: blur(10px) brightness(1); }
          19%     { opacity:.50; filter: blur(9px)  brightness(1.35); }
          20%,54% { opacity:.50; filter: blur(10px) brightness(1); }
          55%     { opacity:.32; filter: blur(9px)  brightness(1.4); }
          56%,100%{ opacity:.50; filter: blur(10px) brightness(1); }
        }
        .tg-sun-rays::after {
          content:""; position:absolute; inset:-30%; pointer-events:none; mix-blend-mode: screen;
          filter: blur(6px); opacity: 0;
          background: conic-gradient(
            from calc(var(--sun-angle, 0deg) + var(--spark-angle, 0deg))
            at var(--sun-x, 110%) var(--sun-y, 40%),
            rgba(255,255,240,0.30) 0deg, rgba(255,255,240,0.18) 4deg, transparent 7deg
          );
          animation: tg-spark-angle 4.5s ease-in-out infinite;
        }
        @keyframes tg-spark-angle {
          0% { --spark-angle: -8deg; opacity: 0; }
          8% { opacity: .45; }
          18% { --spark-angle: 0deg; opacity: 0; }
          50% { --spark-angle: -8deg; opacity: 0; }
          58% { opacity: .45; }
          68% { --spark-angle: 8deg; opacity: 0; }
          100% { --spark-angle: -8deg; opacity: 0; }
        }

        /* --- BRIGHT YELLOW SHOOTER --- */
        .tg-shoot2 {
          position:absolute; width:3px; height:3px; border-radius:9999px;
          background: radial-gradient(circle, #ffdf55 0%, #ffd000 55%, rgba(255,208,0,0.6) 70%, transparent 75%);
          box-shadow: 0 0 18px rgba(255,200,0,0.95), 0 0 36px rgba(255,200,0,0.6);
          will-change: transform, opacity, filter; opacity:0; mix-blend-mode: screen; filter: brightness(1.15) saturate(1.05);
          animation: tg-shoot2 var(--dur,1.4s) cubic-bezier(.22,.61,.36,1) 1 forwards;
        }
        .tg-shoot2::after {
          content:""; position:absolute; right:100%; top:50%; transform: translateY(-50%);
          height:2px; width:240px; filter: blur(0.5px);
background: linear-gradient(90deg,
  rgba(255,212,0,0.00) 0%,
  rgba(255,212,0,0.65) 35%,
  rgba(255,255,255,0.95) 85%,
  rgba(255,255,255,0.00) 100%);
        }
  .tg-shoot2::before {
  content:"";
  position:absolute; right:100%; top:50%; transform: translateY(-50%);
  height:4px; width:320px;
  filter: blur(3px) saturate(1.1);
  background: linear-gradient(90deg,
    rgba(255,187,0,0.00) 0%,
    rgba(255,187,0,0.35) 40%,
    rgba(255,255,255,0.45) 85%,
    rgba(255,255,255,0.00) 100%);
  pointer-events:none;
}
@keyframes tg-shoot2 {
  0%  { opacity:0;   transform: translate(0,0) rotate(var(--ang,-15deg)); }
  6%  { opacity:0.9; }
  85% { opacity:0.9; }
  100%{ opacity:0;   transform: translate(var(--tx,60vw), var(--ty,24vh)) rotate(var(--ang,-15deg)); }
}

        /* --- Tiny Parallax (mouse/tilt) --- */
        .parallax-sun, .parallax-stars { will-change: transform; transition: transform 80ms linear; }
        .parallax-sun  { transform: translate(calc(var(--px, 0) * 8px),  calc(var(--py, 0) * 8px)); }
        .parallax-stars{ transform: translate(calc(var(--px, 0) * -3px), calc(var(--py, 0) * -3px)); }

@media (prefers-reduced-motion: reduce) {
  .twinkle-star { animation: none !important; }
  .tg-shoot2,
  .tg-shoot2::before,
  .tg-shoot2::after { display: none !important; }
  .parallax-sun, .parallax-stars { transform: none !important; transition: none !important; }
}
      `}</style>

      {/* LAYER 0: backdrop (behind everything in this component) */}
      <div className="absolute inset-0 bg-black z-0" />

      {/* LAYER 1: sun group (absolute so it paints above backdrop) */}
      <div className="parallax-sun absolute inset-0 z-10">
        {/* Change --sun-x to -10% for left, 110% for right */}
        <div className="tg-sun-glow" style={{ ["--sun-x" as any]: "50%", ["--sun-y" as any]: "10%" }} />
        <div className="tg-sun-rays" style={{ ["--sun-x" as any]: "50%", ["--sun-y" as any]: "10%" }} />
      </div>

      {/* LAYER 2: stars (absolute; above sun for a nice light-over effect if desired) */}
      <div className="parallax-stars absolute inset-0 z-20">
        {stars.map((s, i) => (
          <div
            key={i}
            className="twinkle-star"
            style={{
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: `${s.size}px`,
              height: `${s.size}px`,
              animationDelay: `${s.delay}s`,
              opacity: s.opacity,
            }}
          />
        ))}
      </div>

      {/* LAYER 3: shooters (highest in this component so they streak above all) */}
      <div className="absolute inset-0 z-30">
        {shooters.map((s) => (
          <div
            key={s.id}
            className="tg-shoot2"
            style={{
              left: `${s.left}vw`,
              top: `${s.top}vh`,
              ["--tx" as any]: `${s.tx}vw`,
              ["--ty" as any]: `${s.ty}vh`,
              ["--ang" as any]: `${s.ang}deg`,
              ["--dur" as any]: `${s.dur}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* =============================
   SMALL UI PIECES & ICONS
   ============================= */
function Input({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  min,
  step,
  className,
}: {
  label: string;
  name: string;
  value: any;
  onChange: any;
  type?: string;
  placeholder?: string;
  min?: string;
  step?: string;
  className?: string;
}) {
  return (
    <label className="flex flex-col text-sm">
      <span className="text-neutral-400 mb-1">{label}</span>
      <input
        className={`h-12 rounded-xl px-3 outline-none focus:border-neutral-600 ${className || ""}`}
        name={name}
        value={value}
        onChange={onChange}
        type={type}
        placeholder={placeholder}
        min={min}
        step={step}
        aria-label={label}
      />
    </label>
  );
}


function Select({
  label,
  name,
  value,
  onChange,
  options,
  className,
  renderAsDate,
}: {
  label: string;
  name: string;
  value: any;
  onChange: any;
  options: any[];
  className?: string;
  renderAsDate?: boolean;
}) {
  const fmtOpt = (o: any) => {
    const s = String(o);
    if (renderAsDate && s && s.length === 10 && s[4] === "-" && s[7] === "-") {
      const y = s.slice(0, 4),
        m = s.slice(5, 7),
        d = s.slice(8, 10);
      return `${Number(m)}/${Number(d)}/${y}`;
    }
    return s === "" ? "— Select —" : s;
  };


  return (
    <label className="flex flex-col text-sm">
      <span className="text-neutral-400 mb-1">{label}</span>
      <select
        className={`h-12 rounded-xl px-3 outline-none focus:border-neutral-600 ${className || ""}`}
        name={name}
        value={value}
        onChange={onChange}
      >
        {options.map((o: any, idx: number) => (
          <option key={o ?? `opt-${idx}`} value={o}>
            {fmtOpt(o)}
          </option>
        ))}
      </select>
    </label>
  );
}


function MiniCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 ${className}`}>
      <div className="text-neutral-300 text-xs uppercase tracking-widest mb-2">{title}</div>
      {children}
    </div>
  );
}


function InfoHover({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative inline-block group mt-1">
      <span className="text-[11px] text-neutral-400 underline decoration-dotted cursor-help select-none">
        What’s this?
      </span>
      <div className="absolute left-0 z-30 mt-2 hidden w-80 group-hover:block">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/95 backdrop-blur p-3 shadow-2xl">
          <div className="text-neutral-200 text-xs leading-snug">
            <div className="font-medium mb-1">{title}</div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}


function Row({
  icon,
  label,
  value,
  sub,
  help,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  help?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 text-neutral-300 text-sm">
          {icon}
          {label}
        </div>
        {help && <div>{help}</div>}
      </div>
      <div className="text-right">
        <div className="text-neutral-100">{value}</div>
        {sub && <div className="text-[11px] text-neutral-500">{sub}</div>}
      </div>
    </div>
  );
}


function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-neutral-900/60 p-3 border border-neutral-800">
      <div className="text-neutral-400 text-xs">{label}</div>
      <div className="text-neutral-100 text-base mt-1">{value as any}</div>
    </div>
  );
}


function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`${tone} font-medium`}>{children}</span>;
}


function WhyScoreTooltip({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="relative inline-block group mt-1">
      <span
        className="text-[11px] text-neutral-400 underline decoration-dotted cursor-help select-none"
        aria-label="Why this score"
      >
        Why this score
      </span>
      <div className="absolute right-0 z-20 mt-2 hidden w-80 group-hover:block">
        <div
          role="tooltip"
          className="rounded-xl border border-neutral-800 bg-neutral-900/90 backdrop-blur p-3 shadow-2xl"
        >
          <div className="space-y-2 text-xs text-neutral-200 leading-snug">
            {items.map((e, i) => (
              <div key={i} className="flex gap-2">
                <span className="mt-0.5">•</span>
                <span>{e}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


function LoaderSpinner() {
  return (
    <svg
      className="animate-spin mx-auto h-8 w-8 text-neutral-300"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}


/* ---------- Ticker Autocomplete (FIXED) ---------- */
function TickerAutocomplete({
  label,
  value,
  query,
  setQuery,
  options,
  open,
  setOpen,
  activeIdx,
  setActiveIdx,
  onPick,
}: {
  label: string;
  value: string;
  query: string;
  setQuery: (v: string) => void;
  options: Array<{ symbol: string; name?: string }>;
  open: boolean;
  setOpen: (b: boolean) => void;
  activeIdx: number;
  setActiveIdx: (n: number) => void;
  onPick: (symbol: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
// De-dupe rapid commits (keydown + blur)
const lastCommitAtRef = useRef(0);

function commitTypedTicker(reason: "enter" | "tab" | "blur" | "manual") {
  const now = Date.now();
  if (now - lastCommitAtRef.current < 150) return; // guard against double fire
  lastCommitAtRef.current = now;

  const typed = (query || "").trim().toUpperCase();
  if (!typed) return;

  const picked =
    (open && options.length ? (options[activeIdx] || options[0])?.symbol : undefined) ||
    typed;

  onPick(picked);
}

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [setOpen]);


  return (
    <div className="flex flex-col text-sm relative z-[60]" ref={boxRef}>
      <span className="text-neutral-400 mb-1">{label}</span>
    <input
  className="h-12 rounded-xl px-3 outline-none focus:border-neutral-600 solid-input uppercase"
  name="ticker"
  value={query}
  onChange={(e) => {
    const v = e.target.value.toUpperCase().replaceAll(" ", "");
    setQuery(v);
    setOpen(true);
  }}
  onFocus={() => setOpen(options.length > 0)}
onKeyDown={(e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    commitTypedTicker("enter");         // commits highlighted or typed value
  } else if (e.key === "Tab") {
    // commit before focus leaves (don’t preventDefault so tab still works)
    commitTypedTicker("tab");
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    // ensure menu is open so highlight makes sense
    setOpen(true);
    setActiveIdx((i) => Math.min(((i ?? -1) + 1), Math.max(options.length - 1, 0)));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setOpen(true);
    setActiveIdx((i) => Math.max(((i ?? options.length) - 1), 0));
  } else if (e.key === "Escape") {
    setOpen(false);
  }
}}
   onBlur={() => commitTypedTicker("blur")}
  placeholder="TSLA"
  aria-label={label}
/>
      {open && options.length > 0 && (
        <div className="absolute z-[60] top-full left-0 right-0 mt-1 rounded-xl border border-neutral-800 bg-neutral-900/95 backdrop-blur shadow-2xl overflow-hidden">
          <ul className="max-h-64 overflow-auto">
            {options.map((o, i) => (
              <li
                key={o.symbol}
                className={`px-3 py-2 cursor-pointer text-sm flex items-center justify-between ${
                  i === activeIdx ? "bg-neutral-800" : "hover:bg-neutral-850"
                }`}
                onMouseEnter={() => setActiveIdx(i)}
onMouseDown={(e) => {
  e.preventDefault();         // commit before the input blurs
  setOpen(false);             // close the menu immediately
  onPick(o.symbol);           // hand the selection to parent
}}
                title={o.name || o.symbol}
              >
                <span className="font-medium">{o.symbol}</span>
                <span className="text-neutral-400 ml-3 truncate">{o.name || ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


/* Icons */
const IconVol = (
  <svg
    className="w-4 h-4 text-neutral-400"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M3 3v18M21 21H7M7 15l4-4 3 3 6-6" />
  </svg>
);
const IconDelta = (
  <svg
    className="w-4 h-4 text-neutral-400"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M12 4l9 16H3z" />
  </svg>
);
const IconTheta = (
  <svg
    className="w-4 h-4 text-neutral-400"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="12" cy="12" r="8" />
    <path d="M8 12h8" />
  </svg>
);
const IconVega = (
  <svg
    className="w-4 h-4 text-neutral-400"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M4 17l6-10 6 10" />
    <path d="M10 13h4" />
  </svg>
);
const IconOI = (
  <svg
    className="w-4 h-4 text-neutral-400"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="3" y="4" width="18" height="4" />
    <rect x="3" y="10" width="18" height="4" />
    <rect x="3" y="16" width="18" height="4" />
  </svg>
);
const IconCalendarAmber = (
  <svg
    className="w-5 h-5 text-amber-300"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);


/* =============================
   FORMATTERS & BADGES
   ============================= */
function fmt(n: number | string) {
  const val = typeof n === "string" && n.trim() === "" ? NaN : Number(n);
  if (!Number.isFinite(val)) return "—";
  return val.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}
function fmtStrike(n: number) {
  return Number.isFinite(n)
    ? `$${n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : "—";
}
function ivBadge(ivPct?: number | null) {
  if (!Number.isFinite(ivPct as number))
    return { label: "—", note: "No IV", tone: "text-neutral-400" };
  const v = ivPct as number;
  if (v >= 60) return { label: `${v.toFixed(0)}%`, note: "elevated", tone: "text-red-400" };
  if (v >= 40) return { label: `${v.toFixed(0)}%`, note: "normal-ish", tone: "text-yellow-400" };
  return { label: `${v.toFixed(0)}%`, note: "low", tone: "text-green-400" };
}
function deltaBadge(delta: number) {
  if (!Number.isFinite(delta)) return { tone: "text-neutral-400" };
  const a = Math.abs(delta);
  if (a >= 0.7) return { tone: "text-red-400" };
  if (a >= 0.4) return { tone: "text-yellow-400" };
  return { tone: "text-green-400" };
}
function thetaBadge(theta: number) {
  if (!Number.isFinite(theta)) return { tone: "text-neutral-400" };
  const mag = Math.abs(theta);
  if (mag >= 0.2) return { tone: "text-red-400" };
  if (mag >= 0.05) return { tone: "text-yellow-400" };
  return { tone: "text-green-400" };
}
function vegaBadge(vega: number) {
  if (!Number.isFinite(vega)) return { tone: "text-neutral-400" };
  const a = Math.abs(vega);
  if (a >= 0.2) return { tone: "text-red-400" };
  if (a >= 0.05) return { tone: "text-yellow-400" };
  return { tone: "text-green-400" };
}
function oiBadge(oi: number) {
  if (!Number.isFinite(oi)) return { tone: "text-neutral-400" };
  if (oi >= 5000) return { tone: "text-green-400" };
  if (oi >= 500) return { tone: "text-yellow-400" };
  return { tone: "text-red-400" };
}
