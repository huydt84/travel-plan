import { NextResponse } from "next/server";
import { verifyRevalidation } from "../../../../lib/revalidation-signature.mjs";
import { expireTravelPlansCache } from "../../../../lib/trip-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const signature = request.headers.get("x-trip-signature");
  const authorized = verifyRevalidation(
    { slug: body.slug, timestamp: body.timestamp, signature },
    process.env.AUTH_SECRET,
  );
  if (!authorized) {
    return NextResponse.json({ error: "Invalid or expired signature" }, { status: 401 });
  }

  expireTravelPlansCache();
  return NextResponse.json({ revalidated: true, slug: body.slug });
}
