import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { requireAdmin } from "../../../../../../lib/auth";
import { deleteSource, updateSource } from "../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../lib/trip-cache";
import { parseSourceInput, readJsonBody, ValidationError } from "../../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const parseSourceNumber = (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new ValidationError("sourceNumber must be a positive integer");
  return number;
};

export async function PATCH(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug, sourceNumber } = await context.params;
  try {
    const source = await updateSource(slug, parseSourceNumber(sourceNumber), parseSourceInput(await readJsonBody(request), { partial: true }));
    expireTravelPlansCache();
    return NextResponse.json(source);
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug, sourceNumber } = await context.params;
  try {
    await deleteSource(slug, parseSourceNumber(sourceNumber));
    expireTravelPlansCache();
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
