import { NextResponse } from "next/server";
import { apiError } from "../../../../lib/api-response";
import { requireAdmin } from "../../../../lib/auth";
import { deleteTrip, updateTrip } from "../../../../lib/itinerary-repository";
import { expireTravelPlansCache, getCachedItinerary } from "../../../../lib/trip-cache";
import { parseTripInput, readJsonBody } from "../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, context) {
  const { slug } = await context.params;
  try { return NextResponse.json(await getCachedItinerary(slug)); }
  catch (error) { return apiError(error); }
}

export async function PATCH(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug } = await context.params;
  try {
    const input = parseTripInput(await readJsonBody(request), { partial: true });
    const trip = await updateTrip(slug, input);
    expireTravelPlansCache();
    return NextResponse.json(trip);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug } = await context.params;
  try {
    await deleteTrip(slug);
    expireTravelPlansCache();
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
