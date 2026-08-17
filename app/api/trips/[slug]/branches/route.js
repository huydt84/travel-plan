import { NextResponse } from "next/server";
import { apiError } from "../../../../../lib/api-response";
import { getViewer, requireAdmin } from "../../../../../lib/auth";
import { createBranchGroup } from "../../../../../lib/itinerary-repository";
import { expireTravelPlansCache } from "../../../../../lib/trip-cache";
import { parseBranchGroupInput, readJsonBody } from "../../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, context) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  const viewer = await getViewer();
  const { slug } = await context.params;
  try {
    const plan = await createBranchGroup(slug, parseBranchGroupInput(await readJsonBody(request)), viewer.email);
    expireTravelPlansCache();
    return NextResponse.json(plan, { status: 201 });
  } catch (error) { return apiError(error); }
}
