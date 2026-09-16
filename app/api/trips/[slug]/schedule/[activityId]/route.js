import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { getViewer } from "../../../../../../lib/auth";
import { deleteScheduleItem, getScheduleItem, updateScheduleItem } from "../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../lib/trip-cache";
import { parseScheduleInput, readJsonBody, ValidationError } from "../../../../../../lib/validation";
import { requireTripAccess } from "../../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idFrom = (value) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError("activityId must be a positive integer");
  return value;
};

export async function GET(_request, context) {
  const { slug, activityId } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug);
    return NextResponse.json(await getScheduleItem(slug, idFrom(activityId)));
  }
  catch (error) { return apiError(error); }
}

export async function PATCH(request, context) {
  const { slug, activityId } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const input = parseScheduleInput(await readJsonBody(request), { partial: true });
    const item = await updateScheduleItem(slug, idFrom(activityId), input);
    await recordTripAudit(slug, viewer, { action: "activity.updated", entityType: "activity", entityId: item.id, after: item });
    expireTravelPlansCache();
    return NextResponse.json(item);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request, context) {
  const { slug, activityId } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const id = idFrom(activityId);
    const before = await getScheduleItem(slug, id);
    await deleteScheduleItem(slug, id);
    await recordTripAudit(slug, viewer, { action: "activity.deleted", entityType: "activity", entityId: id, before });
    expireTravelPlansCache();
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
