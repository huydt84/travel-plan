import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { requireAdmin } from "../../../../../../lib/auth";
import { createBranchOption, unwrapBranchGroup } from "../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../lib/trip-cache";
import { parseBranchInput, parseBranchUnwrapInput, readJsonBody, ValidationError } from "../../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idFrom = (value, field) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError(`${field} must be a positive integer`);
  return value;
};

export async function POST(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug, groupId } = await context.params;
  try {
    const plan = await createBranchOption(slug, idFrom(groupId, "groupId"), parseBranchInput(await readJsonBody(request)));
    expireTravelPlansCache();
    return NextResponse.json(plan, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug, groupId } = await context.params;
  try {
    const input = parseBranchUnwrapInput(await readJsonBody(request));
    const plan = await unwrapBranchGroup(slug, idFrom(groupId, "groupId"), input.keepBranchId);
    expireTravelPlansCache();
    return NextResponse.json(plan);
  } catch (error) { return apiError(error); }
}
