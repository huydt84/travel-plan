import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { requireAdmin } from "../../../../../lib/auth";
import { createPlace } from "../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../lib/trip-cache";
import { parsePlaceInput, readJsonBody } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug } = await context.params;
  try {
    const place = await createPlace(slug, parsePlaceInput(await readJsonBody(request)));
    expireTravelPlansCache();
    return NextResponse.json(place, { status: 201 });
  } catch (error) { return apiError(error); }
}
