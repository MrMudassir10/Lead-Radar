import { handle, json, requireUser } from "@/lib/http";
import { DEFAULT_ICP, type Icp } from "@/lib/scoring";

export const GET = handle(async () => {
  const user = await requireUser();
  return json({ email: user.email, credits: user.credits, icp: (user.icp as Icp | null) ?? DEFAULT_ICP });
});
