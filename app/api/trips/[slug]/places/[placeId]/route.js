import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { requireAdmin } from "../../../../../../lib/auth";
import { deletePlace, updatePlace } from "../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../lib/trip-cache";
import { parsePlaceInput, readJsonBody, ValidationError } from "../../../../../../lib/validation";

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
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug, placeId } = await context.params;
  try {
    const place = await updatePlace(slug, parsePlaceId(placeId), parsePlaceInput(await readJsonBody(request)));
    expireTravelPlansCache();
    return NextResponse.json(place);
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug, placeId } = await context.params;
  try {
    await deletePlace(slug, parsePlaceId(placeId));
    expireTravelPlansCache();
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
