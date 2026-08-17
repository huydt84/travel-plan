import { NextResponse } from "next/server";
import { apiError } from "../../../../../../../lib/api-response";
import { getViewer, requireAdmin } from "../../../../../../../lib/auth";
import { selectBranch } from "../../../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../../../lib/trip-cache";
import { parseBranchSelectionInput, readJsonBody, ValidationError } from "../../../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const viewer = await getViewer();
  const { slug, groupId } = await context.params;
  try {
    if (!/^\d+$/.test(groupId) || Number(groupId) <= 0) throw new ValidationError("groupId must be a positive integer");
    const { branchId } = parseBranchSelectionInput(await readJsonBody(request));
    const plan = await selectBranch(slug, groupId, branchId, viewer.email);
    expireTravelPlansCache();
    return NextResponse.json(plan);
  } catch (error) { return apiError(error); }
}
