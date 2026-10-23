import { prisma } from "@/lib/db";
import { enrichWebsite } from "@/lib/enrich";
import { fail, handle, HttpError, json, requireUser } from "@/lib/http";
import { DEFAULT_ICP, scoreLead, type Icp } from "@/lib/scoring";

// Reads the business's own website, then charges one credit only if that worked.
export const POST = handle(async (_req, ctx) => {
  const user = await requireUser();
  const lead = await prisma.lead.findFirst({ where: { id: ctx.params.id, userId: user.id } });
  if (!lead) return fail("Lead not found", 404);
  if (lead.enrichedAt) return json({ lead, credits: user.credits });
  if (!lead.website) return fail("This business has no website listed, so there is nothing to enrich.", 422);
  if (user.credits < 1) return fail("You are out of credits.", 402);

  let facts;
  try {
    facts = await enrichWebsite(lead.website);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return fail(`Could not read the website (${msg}). No credit was used.`, 502);
  }

  const icp = (user.icp as Icp | null) ?? DEFAULT_ICP;
  const merged = {
    phone: lead.phone ?? facts.phones[0] ?? null,
    email: lead.email ?? facts.emails[0] ?? null,
    signals: facts.signals,
    foundedYear: lead.foundedYear ?? facts.foundedYear,
    enrichedAt: new Date(),
  };
  const score = scoreLead({ ...lead, ...merged }, icp).total;

  const updated = await prisma.$transaction(async (tx) => {
    const charged = await tx.user.updateMany({ where: { id: user.id, credits: { gte: 1 } }, data: { credits: { decrement: 1 } } });
    if (charged.count === 0) throw new HttpError("You are out of credits.", 402);
    await tx.creditLedger.create({ data: { userId: user.id, delta: -1, reason: "enrich", leadId: lead.id } });
    return tx.lead.update({ where: { id: lead.id }, data: { ...merged, score } });
  });

  return json({ lead: updated, credits: user.credits - 1 });
});
