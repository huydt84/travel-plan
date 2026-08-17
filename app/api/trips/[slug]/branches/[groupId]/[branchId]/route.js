import { NextResponse } from "next/server";
import { apiError } from "../../../../../../../lib/api-response";
import { requireAdmin } from "../../../../../../../lib/auth";
import { deleteBranchOption, updateBranchOption } from "../../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../../lib/trip-cache";
import { parseBranchInput, readJsonBody, ValidationError } from "../../../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idFrom = (value, field) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError(`${field} must be a positive integer`);
  return value;
};

export async function PATCH(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug, groupId, branchId } = await context.params;
  try {
    const plan = await updateBranchOption(slug, idFrom(groupId, "groupId"), idFrom(branchId, "branchId"), parseBranchInput(await readJsonBody(request), { partial: true }));
    expireTravelPlansCache();
    return NextResponse.json(plan);
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const { slug, groupId, branchId } = await context.params;
  try {
    const plan = await deleteBranchOption(slug, idFrom(groupId, "groupId"), idFrom(branchId, "branchId"));
    expireTravelPlansCache();
    return NextResponse.json(plan);
  } catch (error) { return apiError(error); }
}
