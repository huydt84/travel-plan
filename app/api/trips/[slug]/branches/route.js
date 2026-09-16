import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer } from "../../../../../lib/auth";
import { createBranchGroup } from "../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../lib/trip-cache";
import { parseBranchGroupInput, readJsonBody } from "../../../../../lib/validation";
import { requireTripAccess } from "../../../../../lib/trip-access-repository";
import { recordTripAudit } from "../../../../../lib/trip-audit-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, context) {
  const viewer = await getViewer();
  const { slug } = await context.params;
  try {
    await requireTripAccess(viewer, slug, "manage");
    const plan = await createBranchGroup(slug, parseBranchGroupInput(await readJsonBody(request)), viewer.email);
    await recordTripAudit(slug, viewer, { action: "branch_group.created", entityType: "branch_group", after: { count: plan.branchGroups?.length || 0 } });
    expireTravelPlansCache();
    return NextResponse.json(plan, { status: 201 });
  } catch (error) { return apiError(error); }
}
