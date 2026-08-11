import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { requireOwner } from "../../../../../../lib/auth";
import { deleteScheduleItem, getScheduleItem, updateScheduleItem } from "../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../lib/trip-cache";
import { parseScheduleInput, readJsonBody, ValidationError } from "../../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idFrom = (value) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError("activityId must be a positive integer");
  return value;
};

export async function GET(_request, context) {
  const { slug, activityId } = await context.params;
  try { return NextResponse.json(await getScheduleItem(slug, idFrom(activityId))); }
  catch (error) { return apiError(error); }
}

export async function PATCH(request, context) {
  const unauthorized = await requireOwner();
  if (unauthorized) return unauthorized;
  const { slug, activityId } = await context.params;
  try {
    const input = parseScheduleInput(await readJsonBody(request), { partial: true });
    const item = await updateScheduleItem(slug, idFrom(activityId), input);
    expireTravelPlansCache();
    return NextResponse.json(item);
  } catch (error) { return apiError(error); }
}

export async function DELETE(request, context) {
  const unauthorized = await requireOwner();
  if (unauthorized) return unauthorized;
  const { slug, activityId } = await context.params;
  try {
    await deleteScheduleItem(slug, idFrom(activityId));
    expireTravelPlansCache();
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
