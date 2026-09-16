import { NextResponse } from "next/server";
import { getViewer } from "../../../lib/auth";
import { getGoogleMailAuthorizationState } from "../../../lib/google-mail-auth.mjs";
import { listPersonalInvitationHistory } from "../../../lib/invitation-repository";
import {
  readInvitationQuota,
  resolveInvitationPermission,
} from "../../../lib/invitation-permission-repository";
import { getCachedItinerary } from "../../../lib/trip-cache";
import { requireTripAccess } from "../../../lib/trip-access-repository";
import { apiError } from "../../../lib/api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const tripSlug = new URL(request.url).searchParams.get("tripSlug")?.trim() || "";
  if (!tripSlug) return NextResponse.json({ error: "Hãy chọn một chuyến đi hợp lệ" }, { status: 400 });

  try {
    const viewer = await getViewer();
    await requireTripAccess(viewer, tripSlug, "manageMembers");
    const plan = await getCachedItinerary(tripSlug);

    const [permission, quota, history, mailState] = await Promise.all([
      resolveInvitationPermission(viewer),
      readInvitationQuota(viewer.email),
      listPersonalInvitationHistory({ inviterEmail: viewer.email, tripSlug, limit: 20 }),
      viewer.authMode === "local-dev"
        ? Promise.resolve({ authorized: true, email: viewer.email })
        : getGoogleMailAuthorizationState(request),
    ]);
    return NextResponse.json({
      authState: "authenticated",
      isOwner: Boolean(viewer.isOwner),
      isAdmin: Boolean(viewer.isAdmin),
      permission: permission || { status: "not_requested" },
      gmailAuthorized: Boolean(mailState.authorized && mailState.email === viewer.email),
      quota,
      history,
      trip: { slug: plan.trip.slug, title: plan.trip.title },
    });
  } catch (error) {
    return apiError(error);
  }
}
