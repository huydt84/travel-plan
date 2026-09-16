import { NextResponse } from "next/server";
import { apiError } from "../../../../../../../lib/api-response";
import { getViewer } from "../../../../../../../lib/auth";
import { deleteBranchOption, updateBranchOption } from "../../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../../lib/trip-cache";
import { parseBranchInput, readJsonBody, ValidationError } from "../../../../../../../lib/validation";
import { requireTripAccess } from "../../../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idFrom = (value, field) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError(`${field} must be a positive integer`);
  return value;
};

export async function PATCH(request, context) {
  const { slug, groupId, branchId } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const plan = await updateBranchOption(slug, idFrom(groupId, "groupId"), idFrom(branchId, "branchId"), parseBranchInput(await readJsonBody(request), { partial: true }));
    await recordTripAudit(slug, viewer, { action: "branch.updated", entityType: "branch", entityId: branchId });
    expireTravelPlansCache();
    return NextResponse.json(plan);
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request, context) {
  const { slug, groupId, branchId } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const plan = await deleteBranchOption(slug, idFrom(groupId, "groupId"), idFrom(branchId, "branchId"));
    await recordTripAudit(slug, viewer, { action: "branch.deleted", entityType: "branch", entityId: branchId });
    expireTravelPlansCache();
    return NextResponse.json(plan);
  } catch (error) { return apiError(error); }
}
