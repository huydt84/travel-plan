import { timingSafeEqual } from "node:crypto";
import { dispatchAssistantJobs } from "../../../../lib/v1/dispatch";
import { resolveAgenticV1Config } from "../../../../lib/v1/config.mjs";
export const maxDuration = 60;
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return new Response(null, { status: 401 });
  if (resolveAgenticV1Config().enabled) await dispatchAssistantJobs();
  return Response.json({ ok: true });
}
