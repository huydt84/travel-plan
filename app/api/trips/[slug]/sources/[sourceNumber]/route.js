import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { getViewer } from "../../../../../../lib/auth";
import { deleteSource, updateSource } from "../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../lib/trip-cache";
import { parseSourceInput, readJsonBody, ValidationError } from "../../../../../../lib/validation";
import { requireTripAccess } from "../../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const parseSourceNumber = (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new ValidationError("sourceNumber must be a positive integer");
  return number;
};

export async function PATCH(request, context) {
  const { slug, sourceNumber } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const source = await updateSource(slug, parseSourceNumber(sourceNumber), parseSourceInput(await readJsonBody(request), { partial: true }));
    await recordTripAudit(slug, viewer, { action: "source.updated", entityType: "source", entityId: source.number, after: source });
    expireTravelPlansCache();
    return NextResponse.json(source);
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request, context) {
  const { slug, sourceNumber } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const number = parseSourceNumber(sourceNumber);
    await deleteSource(slug, number);
    await recordTripAudit(slug, viewer, { action: "source.deleted", entityType: "source", entityId: number });
    expireTravelPlansCache();
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
