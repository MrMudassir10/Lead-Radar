import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkPassword, startSession } from "@/lib/auth";
import { fail, handle, json, rateLimit } from "@/lib/http";

const body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(100) });

export const POST = handle(async (req) => {
  rateLimit(`login:${req.headers.get("x-forwarded-for") ?? "local"}`, 10, 60_000);
  const { email, password } = body.parse(await req.json());
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await checkPassword(password, user.passwordHash))) return fail("Wrong email or password", 401);
  await startSession(user.id);
  return json({ ok: true });
});
