import { describe, expect, it } from "vitest";
import { DEFAULT_ICP, PRESETS, scoreLead, tierOf, type ScorableLead } from "@/lib/scoring";
import { draftEmail } from "@/lib/outreach";
import { csvCell } from "@/lib/csv";

const base: ScorableLead = { industry: "HVAC", website: "https://x.com", phone: "123", email: null, signals: [], foundedYear: null };
const now = new Date("2026-10-20");

describe("scoreLead", () => {
  it("rewards long-established, family-owned businesses for buyers", () => {
    const old = scoreLead({ ...base, foundedYear: 1990, signals: ["family_owned"] }, DEFAULT_ICP, now);
    const young = scoreLead({ ...base, foundedYear: 2022 }, DEFAULT_ICP, now);
    expect(old.total).toBeGreaterThan(young.total);
    expect(old.parts.legacy).toBe(100);
  });

  it("rewards digital gaps for sellers", () => {
    const sell = { ...DEFAULT_ICP, mode: "sell" as const, weights: { ...PRESETS.sell } };
    const gappy = scoreLead({ ...base, signals: ["no_booking", "no_mobile"] }, sell, now);
    const polished = scoreLead({ ...base, signals: ["online_booking"] }, sell, now);
    expect(gappy.total).toBeGreaterThan(polished.total);
  });

  it("scores a business without a website as a large digital gap", () => {
    expect(scoreLead({ ...base, website: null }, DEFAULT_ICP, now).parts.gap).toBe(60);
  });

  it("penalises industries outside the profile", () => {
    const icp = { ...DEFAULT_ICP, industries: ["Dental"] };
    expect(scoreLead(base, icp, now).parts.fit).toBe(20);
  });

  it("returns 0 when every weight is 0", () => {
    const icp = { ...DEFAULT_ICP, weights: { fit: 0, contact: 0, legacy: 0, growth: 0, gap: 0 } };
    expect(scoreLead(base, icp, now).total).toBe(0);
  });

  it("maps scores to tiers", () => {
    expect([tierOf(80), tierOf(55), tierOf(10)]).toEqual(["hot", "warm", "cold"]);
  });
});

describe("draftEmail", () => {
  it("uses the strongest real signal and fills the placeholders", () => {
    const d = draftEmail({ name: "Acme HVAC", industry: "HVAC", city: "Boise", signals: [], foundedYear: 1990 }, "buy", "friendly", now);
    expect(d.body).toContain("36 years");
    expect(d.subject).toContain("Acme HVAC");
  });
  it("mentions missing online booking when selling", () => {
    const d = draftEmail({ name: "Acme", industry: "Dental", city: null, signals: ["no_booking"], foundedYear: null }, "sell", "direct", now);
    expect(d.body).toContain("cannot book online");
  });
});

describe("csvCell", () => {
  it("quotes commas and neutralises spreadsheet formulas", () => {
    expect(csvCell('A, "B"')).toBe('"A, ""B"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
  });
});
