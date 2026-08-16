import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { requireAdmin } from "../../../../../lib/auth";
import { createScheduleItem } from "../../../../../lib/itinerary-repository";
import { expireTravelPlansCache, getCachedItinerary } from "../../../../../lib/trip-cache";
import { parseScheduleInput, readJsonBody } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, context) {
  const { slug } = await context.params;
  try {
    const data = await getCachedItinerary(slug);
    return NextResponse.json({ trip: data.trip, schedule: data.itinerary });
  } catch (error) { return apiError(error); }
}

export async function POST(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug } = await context.params;
  try {
    const input = parseScheduleInput(await readJsonBody(request));
    const item = await createScheduleItem(slug, input);
    expireTravelPlansCache();
    return NextResponse.json(item, { status: 201 });
  } catch (error) { return apiError(error); }
}
