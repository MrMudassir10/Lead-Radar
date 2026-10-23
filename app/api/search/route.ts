import { z } from "zod";
import { prisma } from "@/lib/db";
import { INDUSTRY_NAMES } from "@/lib/categories";
import { discover } from "@/lib/osm";
import { handle, json, rateLimit, requireUser } from "@/lib/http";
import { DEFAULT_ICP, scoreLead, type Icp } from "@/lib/scoring";

const body = z.object({
  industry: z.string().refine((s) => INDUSTRY_NAMES.includes(s), "Pick an industry from the list"),
  place: z.string().trim().min(2, "Enter a city or area").max(120),
});

export const POST = handle(async (req) => {
  const user = await requireUser();
  rateLimit(`search:${user.id}`, 10, 60_000);
  const { industry, place } = body.parse(await req.json());
  const icp = (user.icp as Icp | null) ?? DEFAULT_ICP;

  const found = await discover(industry, place);
  const ops = found.map((b) =>
    prisma.lead.upsert({
      where: { userId_osmId: { userId: user.id, osmId: b.osmId } },
      create: { ...b, userId: user.id, signals: [], score: scoreLead({ ...b, signals: [] }, icp).total },
      update: { name: b.name, address: b.address, city: b.city, lat: b.lat, lon: b.lon },
    }),
  );
  for (let i = 0; i < ops.length; i += 100) await prisma.$transaction(ops.slice(i, i + 100));

  const leads = await prisma.lead.findMany({
    where: { userId: user.id, osmId: { in: found.map((b) => b.osmId) } },
    orderBy: { score: "desc" },
  });
  return json({ found: found.length, leads });
});
