import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseLeads } from "@/lib/csvImport";
import { fail, handle, json, rateLimit, requireUser } from "@/lib/http";
import { DEFAULT_ICP, scoreLead, type Icp } from "@/lib/scoring";

const body = z.object({
  csv: z.string().min(1, "The file is empty").max(5_000_000, "File is too large (limit 5 MB)"),
  defaultIndustry: z.string().trim().max(60).optional(),
});

// Creates leads from an uploaded CSV. Existing leads (same name + website/phone) are updated, not duplicated.
export const POST = handle(async (req) => {
  const user = await requireUser();
  rateLimit(`import:${user.id}`, 5, 60_000);
  const { csv, defaultIndustry } = body.parse(await req.json());

  const parsed = parseLeads(csv);
  if (parsed.error) return fail(parsed.error, 422);
  if (parsed.rows.length === 0) return fail("No usable rows found in the file.", 422);

  const icp = (user.icp as Icp | null) ?? DEFAULT_ICP;
  const existing = await prisma.lead.findMany({
    where: { userId: user.id, osmId: { in: parsed.rows.map((r) => r.key) } },
    select: { osmId: true },
  });
  const had = new Set(existing.map((e) => e.osmId));

  const ops = parsed.rows.map((r) => {
    const industry = r.industry ?? defaultIndustry ?? "Imported";
    const fields = { name: r.name, industry, city: r.city, address: r.address, website: r.website, phone: r.phone, email: r.email, foundedYear: r.foundedYear };
    const score = scoreLead({ ...fields, signals: [] }, icp).total;
    // On update, only fill values the file actually has so enriched data is never erased.
    const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
    return prisma.lead.upsert({
      where: { userId_osmId: { userId: user.id, osmId: r.key } },
      create: { ...fields, userId: user.id, osmId: r.key, signals: [], score },
      update: patch,
    });
  });
  for (let i = 0; i < ops.length; i += 100) await prisma.$transaction(ops.slice(i, i + 100));

  return json({
    imported: parsed.rows.length - had.size,
    updated: had.size,
    skipped: parsed.skipped,
    columns: parsed.columns,
  });
});
