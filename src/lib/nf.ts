type Query = Record<string, any> | undefined;

function qs(obj?: Record<string, any>) {
  if (!obj) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") p.append(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function call<T = any>(name: string, params?: Query, init?: RequestInit): Promise<T> {
  const url = `/.netlify/functions/${name}${qs(params)}`;
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error(`[NF] ${name} ${r.status} ${(await r.text().catch(()=>''))}`.trim());
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : (r.text() as any);
}

export const poly = <T = any>(path: string, query?: Record<string, any>) =>
  call<T>("polygon-proxy", { path, ...(query || {}) });

export const finnhub = <T = any>(path: string, query?: Record<string, any>) =>
  call<T>("finnhub-proxy", { path, ...(query || {}) });

export const tradier = <T = any>(path: string, query?: Record<string, any>) =>
  call<T>("tradier-quote", { path, ...(query || {}) });

export const openaiAnalyze = (payload: any) =>
  call("openai-analyze", undefined, { method: "POST", body: JSON.stringify(payload) });
