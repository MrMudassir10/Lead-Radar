import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { currentUser } from "./auth";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export function errorResponse(e: unknown) {
  if (e instanceof ZodError) return fail(e.issues[0]?.message ?? "Invalid input", 422);
  const message = e instanceof Error ? e.message : "Something went wrong";
  return fail(message, 500);
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError("Please sign in", 401);
  return user;
}

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function handle(fn: (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Record<string, string> }) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.message, e.status);
      return errorResponse(e);
    }
  };
}

// Small in-memory rate limiter (per process). Use Redis when running more than one instance.
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError("Too many requests, wait a minute and try again", 429);
  arr.push(now);
  hits.set(key, arr);
}
