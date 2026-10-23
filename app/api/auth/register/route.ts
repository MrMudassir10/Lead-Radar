import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, startSession } from "@/lib/auth";
import { fail, handle, json, rateLimit } from "@/lib/http";

const body = z.object({
  email: z.string().email("Enter a valid email").max(200),
  password: z.string().min(8, "Password needs at least 8 characters").max(100),
});

export const POST = handle(async (req) => {
  rateLimit(`register:${req.headers.get("x-forwarded-for") ?? "local"}`, 10, 60_000);
  const { email, password } = body.parse(await req.json());
  const e = email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email: e } })) return fail("That email is already registered", 409);
  const user = await prisma.user.create({ data: { email: e, passwordHash: await hashPassword(password) } });
  await startSession(user.id);
  return json({ ok: true });
});
