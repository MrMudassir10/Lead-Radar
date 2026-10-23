import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail, handle, json, requireUser } from "@/lib/http";

const body = z.object({
  saved: z.boolean().optional(),
  stage: z.enum(["NEW", "CONTACTED", "REPLIED", "MEETING", "WON"]).optional(),
});

export const PATCH = handle(async (req, ctx) => {
  const user = await requireUser();
  const data = body.parse(await req.json());
  const res = await prisma.lead.updateMany({ where: { id: ctx.params.id, userId: user.id }, data });
  if (res.count === 0) return fail("Lead not found", 404);
  const lead = await prisma.lead.findUnique({ where: { id: ctx.params.id } });
  return json({ lead });
});
