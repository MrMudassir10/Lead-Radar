import { z } from "zod";
import { prisma } from "@/lib/db";
import { INDUSTRY_NAMES } from "@/lib/categories";
import { handle, json, requireUser } from "@/lib/http";
import { scoreLead, type Icp } from "@/lib/scoring";

const w = z.number().int().min(0).max(100);
const icpSchema = z.object({
  mode: z.enum(["buy", "sell"]),
  industries: z.array(z.string().refine((s) => INDUSTRY_NAMES.includes(s), "Unknown industry")).max(20),
  weights: z.object({ fit: w, contact: w, legacy: w, growth: w, gap: w }),
});

// Saves the profile, then re-scores every stored lead so exports and sorting match.
export const PUT = handle(async (req) => {
  const user = await requireUser();
  const icp: Icp = icpSchema.parse(await req.json());
  await prisma.user.update({ where: { id: user.id }, data: { icp } });
  const leads = await prisma.lead.findMany({ where: { userId: user.id } });
  const ops = leads.map((l) => prisma.lead.update({ where: { id: l.id }, data: { score: scoreLead(l, icp).total } }));
  for (let i = 0; i < ops.length; i += 200) await prisma.$transaction(ops.slice(i, i + 200));
  return json({ ok: true, rescored: leads.length });
});
