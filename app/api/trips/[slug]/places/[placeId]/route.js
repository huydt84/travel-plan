import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { getViewer } from "../../../../../../lib/auth";
import { deletePlace, updatePlace } from "../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../lib/trip-cache";
import { parsePlaceInput, readJsonBody, ValidationError } from "../../../../../../lib/validation";
import { requireTripAccess } from "../../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const parsePlaceId = (value) => {
  const normalized = String(value);
  if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) {
    throw new ValidationError("placeId must be a positive integer");
  }
  return normalized;
};

export async function PATCH(request, context) {
  const { slug, placeId } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const place = await updatePlace(slug, parsePlaceId(placeId), parsePlaceInput(await readJsonBody(request)));
    await recordTripAudit(slug, viewer, { action: "place.updated", entityType: "place", entityId: place.id, after: place });
    expireTravelPlansCache();
    return NextResponse.json(place);
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request, context) {
  const { slug, placeId } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const id = parsePlaceId(placeId);
    await deletePlace(slug, id);
    await recordTripAudit(slug, viewer, { action: "place.deleted", entityType: "place", entityId: id });
    expireTravelPlansCache();
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
