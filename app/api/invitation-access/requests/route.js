import { NextResponse } from "next/server";
import { requireAuthenticated } from "../../../../lib/auth";
import { createInvitationPermissionRequest } from "../../../../lib/invitation-permission-repository";
import { getCachedItinerary } from "../../../../lib/trip-cache";
import { readJsonBody, ValidationError } from "../../../../lib/validation";
import { requireTripAccess } from "../../../../lib/trip-access-repository";
import { apiError } from "../../../../lib/api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;

  try {
    const body = await readJsonBody(request);
    const tripSlug = typeof body?.tripSlug === "string" ? body.tripSlug.trim() : "";
    if (!tripSlug) throw new ValidationError("Hãy chọn một chuyến đi hợp lệ");
    await requireTripAccess(viewer, tripSlug, "manageMembers");
    if (viewer.isAdmin) {
      return NextResponse.json({ status: "approved", implicitOwner: true });
    }
    const plan = await getCachedItinerary(tripSlug);
    const permission = await createInvitationPermissionRequest({
      userEmail: viewer.email,
      trip: plan.trip,
    });
    return NextResponse.json(permission, { status: permission.status === "pending" ? 201 : 200 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiError(error);
  }
}
