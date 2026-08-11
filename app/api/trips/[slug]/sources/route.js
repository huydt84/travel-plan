import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { requireOwner } from "../../../../../lib/auth";
import { createSource } from "../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../lib/trip-cache";
import { parseSourceInput, readJsonBody } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, context) {
  const unauthorized = await requireOwner();
  if (unauthorized) return unauthorized;
  const { slug } = await context.params;
  try {
    const input = parseSourceInput(await readJsonBody(request));
    const source = await createSource(slug, input);
    expireTravelPlansCache();
    return NextResponse.json(source, { status: 201 });
  } catch (error) { return apiError(error); }
}
