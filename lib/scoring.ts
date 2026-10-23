// Pure scoring logic. Used on the server (stored score, CSV) and in the browser (instant re-ranking).
export type Mode = "buy" | "sell";
export type FactorKey = "fit" | "contact" | "legacy" | "growth" | "gap";
export type Weights = Record<FactorKey, number>;
export type Icp = { mode: Mode; industries: string[]; weights: Weights };

export const FACTORS: { key: FactorKey; label: string; hint: string }[] = [
  { key: "fit", label: "Industry fit", hint: "Matches the industries you chose" },
  { key: "contact", label: "Reachability", hint: "Phone, website and email found" },
  { key: "legacy", label: "Succession signal", hint: "Years in business, family-owned" },
  { key: "growth", label: "Growth signals", hint: "Hiring, social presence, online booking" },
  { key: "gap", label: "Digital gap", hint: "No online booking, not mobile friendly, no website" },
];

export const PRESETS: Record<Mode, Weights> = {
  buy: { fit: 25, contact: 20, legacy: 35, growth: 10, gap: 10 },
  sell: { fit: 25, contact: 25, legacy: 0, growth: 20, gap: 30 },
};

export const DEFAULT_ICP: Icp = { mode: "buy", industries: [], weights: { ...PRESETS.buy } };

export type ScorableLead = {
  industry: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  signals: string[];
  foundedYear: number | null;
  enrichedAt?: Date | string | null;
};

export type ScoreResult = { total: number; parts: Record<FactorKey, number>; enriched: boolean };

const clamp = (x: number, a = 0, b = 100) => Math.max(a, Math.min(b, x));

export function scoreLead(l: ScorableLead, icp: Icp, now = new Date()): ScoreResult {
  const has = (s: string) => l.signals.includes(s);
  const enriched = !!l.enrichedAt;

  const fit = icp.industries.length === 0 || icp.industries.includes(l.industry) ? 100 : 20;

  const contact = clamp((l.phone ? 35 : 0) + (l.website ? 25 : 0) + (l.email ? 40 : 0));

  let legacy = 25;
  if (l.foundedYear) {
    const years = now.getFullYear() - l.foundedYear;
    legacy = years >= 30 ? 100 : years >= 20 ? 80 : years >= 10 ? 55 : 30;
  }
  if (has("family_owned")) legacy += 20;
  legacy = clamp(legacy);

  let growth = 15;
  if (has("hiring")) growth += 55;
  if (has("social")) growth += 15;
  if (has("online_booking")) growth += 15;
  growth = clamp(growth);

  let gap = l.website ? 0 : 60;
  if (has("no_booking")) gap += 40;
  if (has("no_mobile")) gap += 30;
  if (has("no_https")) gap += 20;
  gap = clamp(gap);

  const parts = { fit, contact, legacy, growth, gap };
  let sum = 0;
  let wsum = 0;
  for (const f of FACTORS) {
    sum += icp.weights[f.key] * parts[f.key];
    wsum += icp.weights[f.key];
  }
  return { total: wsum ? Math.round(sum / wsum) : 0, parts, enriched };
}

export type Tier = "hot" | "warm" | "cold";
export const tierOf = (n: number): Tier => (n >= 70 ? "hot" : n >= 50 ? "warm" : "cold");
