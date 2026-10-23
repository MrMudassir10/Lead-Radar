import { prisma } from "@/lib/db";
import { handle, json, requireUser } from "@/lib/http";

export const GET = handle(async (req) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const industry = url.searchParams.get("industry");
  const saved = url.searchParams.get("saved") === "1";
  const leads = await prisma.lead.findMany({
    where: { userId: user.id, ...(industry ? { industry } : {}), ...(saved ? { saved: true } : {}) },
    orderBy: { score: "desc" },
    take: 500,
  });
  return json({ leads });
});
