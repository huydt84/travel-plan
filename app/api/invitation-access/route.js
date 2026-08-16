import { NextResponse } from "next/server";
import { getViewer } from "../../../lib/auth";
import { getGoogleMailAuthorizationState } from "../../../lib/google-mail-auth.mjs";
import { listPersonalInvitationHistory } from "../../../lib/invitation-repository";
import {
  readInvitationQuota,
  resolveInvitationPermission,
} from "../../../lib/invitation-permission-repository";
import { getCachedItinerary } from "../../../lib/trip-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const tripSlug = new URL(request.url).searchParams.get("tripSlug")?.trim() || "";
  if (!tripSlug) return NextResponse.json({ error: "Hãy chọn một chuyến đi hợp lệ" }, { status: 400 });

  try {
    const plan = await getCachedItinerary(tripSlug);
    const viewer = await getViewer();
    if (!viewer) {
      return NextResponse.json({
        authState: "guest",
        permission: { status: "not_requested" },
        gmailAuthorized: false,
        quota: null,
        history: [],
        trip: { slug: plan.trip.slug, title: plan.trip.title },
      });
    }

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
    if (error.code === "TRIP_NOT_FOUND") {
      return NextResponse.json({ error: "Chuyến đi không còn tồn tại" }, { status: 404 });
    }
    return NextResponse.json({ error: "Không thể tải quyền gửi lời rủ" }, { status: 500 });
  }
}
