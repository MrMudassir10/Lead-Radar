import { prisma } from "@/lib/db";
import { csvCell } from "@/lib/csv";
import { handle, requireUser } from "@/lib/http";

export const GET = handle(async (req) => {
  const user = await requireUser();
  const savedOnly = new URL(req.url).searchParams.get("saved") === "1";
  const leads = await prisma.lead.findMany({
    where: { userId: user.id, ...(savedOnly ? { saved: true } : {}) },
    orderBy: { score: "desc" },
  });
  const head = ["name", "industry", "city", "address", "website", "phone", "email", "founded_year", "score", "stage", "enriched", "signals"];
  const rows = leads.map((l) =>
    [l.name, l.industry, l.city, l.address, l.website, l.phone, l.email, l.foundedYear, l.score, l.saved ? l.stage : "", l.enrichedAt ? "yes" : "no", l.signals.join("|")]
      .map(csvCell)
      .join(","),
  );
  return new Response([head.join(","), ...rows].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="lead-radar-export.csv"' },
  });
});
