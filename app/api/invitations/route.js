import { NextResponse } from "next/server";
import { getViewer, requireOwner } from "../../../lib/auth";
import { getGoogleMailAccess } from "../../../lib/google-mail-auth.mjs";
import {
  InvitationInputError,
  parseInvitationInput,
  sendInvitationBatch,
} from "../../../lib/invitation-email.mjs";
import { readJsonBody, ValidationError } from "../../../lib/validation";
import { getCachedItinerary } from "../../../lib/trip-cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const unauthorized = await requireOwner();
  if (unauthorized) return unauthorized;

  try {
    const input = parseInvitationInput(await readJsonBody(request));
    const inviter = await getViewer();
    const mailAccess = await getGoogleMailAccess(request);
    if (mailAccess.email !== inviter?.email) {
      return NextResponse.json({ error: "Phiên gửi Gmail không khớp với người dùng hiện tại" }, { status: 403 });
    }
    const plan = await getCachedItinerary(input.tripSlug);
    const result = await sendInvitationBatch({
      ...input,
      inviter,
      trip: plan.trip,
      itinerary: plan.itinerary,
      accessToken: mailAccess.accessToken,
    });
    return NextResponse.json({ sent: result.sent }, { status: 201 });
  } catch (error) {
    if (error instanceof InvitationInputError || error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error.code === "INVITATION_CONFIG_ERROR") {
      return NextResponse.json({ error: "Dịch vụ gửi email chưa được cấu hình" }, { status: 503 });
    }
    if (error.code === "INVITATION_AUTH_ERROR") {
      return NextResponse.json({
        error: "Hãy đăng xuất rồi đăng nhập lại bằng Google để cấp quyền gửi Gmail.",
      }, { status: 403 });
    }
    if (error.code === "INVITATION_DELIVERY_ERROR") {
      return NextResponse.json({ error: "Không thể gửi lời rủ lúc này. Vui lòng thử lại." }, { status: 502 });
    }
    if (error.code === "TRIP_NOT_FOUND") {
      return NextResponse.json({ error: "Chuyến đi đã chọn không còn tồn tại" }, { status: 404 });
    }
    return NextResponse.json({ error: "Không thể gửi lời rủ lúc này" }, { status: 500 });
  }
}
