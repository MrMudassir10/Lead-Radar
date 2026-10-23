import type { Mode } from "./scoring";

export type Tone = "friendly" | "direct" | "formal";
export type OutreachLead = {
  name: string;
  industry: string;
  city: string | null;
  signals: string[];
  foundedYear: number | null;
};

export function draftEmail(l: OutreachLead, mode: Mode, tone: Tone, now = new Date()): { subject: string; body: string } {
  const has = (s: string) => l.signals.includes(s);
  const ind = l.industry.toLowerCase();
  const where = l.city ?? "your area";
  const years = l.foundedYear ? now.getFullYear() - l.foundedYear : null;

  let hook: string;
  if (mode === "buy") {
    hook = years && years >= 10
      ? `${l.name} has been around for ${years} years, and I would like to talk about how it could carry on under careful stewardship whenever the time is right for you.`
      : has("family_owned")
        ? `I saw that ${l.name} is family owned, and I would like to learn how you built it.`
        : `I came across ${l.name} while researching ${ind} businesses in ${where}.`;
  } else {
    hook = has("no_booking")
      ? `I noticed customers cannot book online with ${l.name} yet, and that is often where ${ind} businesses lose calls.`
      : has("no_mobile")
        ? `Your website does not look right on a phone, which is where most ${ind} customers search.`
        : has("hiring")
          ? `I saw you are hiring. Teams growing at that pace usually feel scheduling and follow-up gaps first.`
          : `I came across ${l.name} while looking at ${ind} companies in ${where}.`;
  }

  const hi = tone === "formal" ? "Dear team," : tone === "direct" ? "Hello," : "Hi there,";
  const intro =
    mode === "buy"
      ? tone === "direct"
        ? `I am an independent buyer looking to acquire and operate a ${ind} company in ${where}.`
        : `My name is [Your name], and I am looking to acquire and personally run a ${ind} company in ${where}.`
      : tone === "direct"
        ? `I help ${ind} companies in ${where} book more jobs without adding admin work.`
        : `My name is [Your name], and I help ${ind} companies in ${where} book more jobs without adding admin work.`;
  const ask =
    mode === "buy"
      ? tone === "direct" ? "Open to a 15 minute call this week?" : "Would you be open to a short, confidential call? No obligation either way."
      : tone === "direct" ? "Worth a 15 minute call this week?" : "Would a short call next week be useful? I can send a two-line summary first if you prefer.";
  const bye = tone === "formal" ? "Kind regards," : "Thanks,";

  const subject =
    mode === "buy"
      ? tone === "direct" ? `Buying a ${ind} business in ${where}` : tone === "formal" ? `Inquiry regarding ${l.name}` : `A quick question about ${l.name}`
      : tone === "direct" ? `More booked jobs for ${l.name}` : tone === "formal" ? `Proposal for ${l.name}` : `Idea for ${l.name}`;

  return { subject, body: [hi, "", hook, "", intro, "", ask, "", bye, "[Your name]"].join("\n") };
}
