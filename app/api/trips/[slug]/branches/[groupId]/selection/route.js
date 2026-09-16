import { NextResponse } from "next/server";
import { apiError } from "../../../../../../../lib/api-response";
import { getViewer } from "../../../../../../../lib/auth";
import { selectBranch } from "../../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../../lib/trip-cache";
import { parseBranchSelectionInput, readJsonBody, ValidationError } from "../../../../../../../lib/validation";
import { requireTripAccess } from "../../../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request, context) {
  const viewer = await getViewer();
  const { slug, groupId } = await context.params;
  try {
    await requireTripAccess(viewer, slug, "selectBranch");
    if (!/^\d+$/.test(groupId) || Number(groupId) <= 0) throw new ValidationError("groupId must be a positive integer");
    const { branchId } = parseBranchSelectionInput(await readJsonBody(request));
    const plan = await selectBranch(slug, groupId, branchId, viewer.email);
    await recordTripAudit(slug, viewer, { action: "branch.selected", entityType: "branch", entityId: branchId, after: { groupId, branchId } });
    expireTravelPlansCache();
    return NextResponse.json(plan);
  } catch (error) { return apiError(error); }
}
