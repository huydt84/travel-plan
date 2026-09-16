import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { getViewer } from "../../../../../../lib/auth";
import { createBranchOption, unwrapBranchGroup } from "../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../lib/trip-cache";
import { parseBranchInput, parseBranchUnwrapInput, readJsonBody, ValidationError } from "../../../../../../lib/validation";
import { requireTripAccess } from "../../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idFrom = (value, field) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError(`${field} must be a positive integer`);
  return value;
};

export async function POST(request, context) {
  const { slug, groupId } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const plan = await createBranchOption(slug, idFrom(groupId, "groupId"), parseBranchInput(await readJsonBody(request)));
    await recordTripAudit(slug, viewer, { action: "branch.created", entityType: "branch_group", entityId: groupId });
    expireTravelPlansCache();
    return NextResponse.json(plan, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request, context) {
  const { slug, groupId } = await context.params;
  const viewer = await getViewer();
  try {
    await requireTripAccess(viewer, slug, "manage");
    const input = parseBranchUnwrapInput(await readJsonBody(request));
    const plan = await unwrapBranchGroup(slug, idFrom(groupId, "groupId"), input.keepBranchId);
    await recordTripAudit(slug, viewer, { action: "branch_group.unwrapped", entityType: "branch_group", entityId: groupId, after: input });
    expireTravelPlansCache();
    return NextResponse.json(plan);
  } catch (error) { return apiError(error); }
}
