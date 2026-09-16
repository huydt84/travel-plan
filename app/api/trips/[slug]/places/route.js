import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer } from "../../../../../lib/auth";
import { createPlace } from "../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../lib/trip-cache";
import { parsePlaceInput, readJsonBody } from "../../../../../lib/validation";
import { requireTripAccess } from "../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, context) {
  const { slug } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const place = await createPlace(slug, parsePlaceInput(await readJsonBody(request)));
    await recordTripAudit(slug, viewer, { action: "place.created", entityType: "place", entityId: place.id, after: place });
    expireTravelPlansCache();
    return NextResponse.json(place, { status: 201 });
  } catch (error) { return apiError(error); }
}
