import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer } from "../../../../../lib/auth";
import { createScheduleItem } from "../../../../../lib/itinerary-repository";
import { expireTravelPlansCache, getCachedItinerary } from "../../../../../lib/trip-cache";
import { parseScheduleInput, readJsonBody } from "../../../../../lib/validation";
import { requireTripAccess } from "../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, context) {
  const { slug } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug);
    const data = await getCachedItinerary(slug);
    return NextResponse.json({ trip: data.trip, schedule: data.itinerary });
  } catch (error) { return apiError(error); }
}

export async function POST(request, context) {
  const { slug } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const input = parseScheduleInput(await readJsonBody(request));
    const item = await createScheduleItem(slug, input);
    await recordTripAudit(slug, viewer, { action: "activity.created", entityType: "activity", entityId: item.id, after: item });
    expireTravelPlansCache();
    return NextResponse.json(item, { status: 201 });
  } catch (error) { return apiError(error); }
}
