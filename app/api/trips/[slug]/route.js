import { NextResponse } from "next/server";
import { apiError } from "../../../../lib/api-response";
import { getViewer } from "../../../../lib/auth";
import { deleteTrip, updateTrip } from "../../../../lib/itinerary-repository";
import { expireTravelPlansCache, getCachedItinerary } from "../../../../lib/trip-cache";
import { parseTripInput, readJsonBody } from "../../../../lib/validation";
import { requireTripAccess } from "../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, context) {
  const { slug } = await context.params;
  const viewer = await getViewer();
  try {
    const access = await requireTripAccess(viewer, slug);
    return NextResponse.json({ ...(await getCachedItinerary(slug)), access });
  }
  catch (error) { return apiError(error); }
}

export async function PATCH(request, context) {
  const { slug } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const input = parseTripInput(await readJsonBody(request), { partial: true });
    const trip = await updateTrip(slug, input);
    await recordTripAudit(trip.slug, viewer, { action: "trip.updated", entityType: "trip", entityId: trip.slug, after: trip });
    expireTravelPlansCache();
    return NextResponse.json(trip);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request, context) {
  const { slug } = await context.params;
  const viewer = await getViewer();
  try {
    const access = await requireTripAccess(viewer, slug, "manage");
    await recordTripAudit(slug, viewer, { action: "trip.deleted", entityType: "trip", entityId: slug, before: access.trip });
    await deleteTrip(slug);
    expireTravelPlansCache();
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
