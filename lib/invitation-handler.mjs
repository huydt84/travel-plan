import { InvitationInputError, parseInvitationInput } from "./invitation-email.mjs";
import { readJsonBody, ValidationError } from "./validation.js";
import { InvitationPermissionError, InvitationRateLimitError } from "./invitation-permission-store.mjs";

export function createInvitationHandler({
  requireAuthenticated, resolveInvitationPermission, getGoogleMailAccess, getCachedItinerary,
  reserveInvitationBatch, claimInvitationRecipients, sendInvitationBatch, saveInvitationDeliveries,
}) {
  return async function POST(request) {
    const { viewer, response: unauthorized } = await requireAuthenticated();
    if (unauthorized) return unauthorized;

    let history = [];
    let quota = null;
    try {
      const input = parseInvitationInput(await readJsonBody(request));
      const permission = await resolveInvitationPermission(viewer);
      if (permission?.status !== "approved") {
        const status = permission?.status || "not_requested";
        const code = status === "pending" ? "PERMISSION_PENDING"
          : status === "denied" ? "PERMISSION_DENIED"
            : status === "revoked" ? "PERMISSION_REVOKED"
              : "PERMISSION_REQUIRED";
        return Response.json({ error: "Bạn chưa có quyền gửi lời rủ", code }, { status: 403 });
      }
      const mailAccess = await getGoogleMailAccess(request);
      if (mailAccess.email !== viewer.email) {
        return Response.json({ error: "Phiên gửi Gmail không khớp với người dùng hiện tại" }, { status: 403 });
      }
      const plan = await getCachedItinerary(input.tripSlug);
      quota = await reserveInvitationBatch({ requestId: input.requestId, inviterEmail: viewer.email });
      const claimedRecipients = await claimInvitationRecipients({
        requestId: input.requestId,
        inviterEmail: viewer.email,
        recipients: input.recipients,
        trip: plan.trip,
        subject: input.subject,
      });
      const skipped = input.recipients.length - claimedRecipients.length;
      if (!claimedRecipients.length) {
        return Response.json({ sent: 0, skipped, history: [], quota });
      }
      let result;
      try {
        result = await sendInvitationBatch({
          ...input,
          recipients: claimedRecipients,
          inviter: viewer,
          trip: plan.trip,
          itinerary: plan.itinerary,
          accessToken: mailAccess.accessToken,
        });
      } catch (deliveryError) {
        const deliveries = deliveryError.deliveries?.length
          ? deliveryError.deliveries
          : claimedRecipients.map((recipient) => ({
            recipient,
            status: "failed",
            gmailMessageId: null,
            errorCode: deliveryError.code || "INVITATION_DELIVERY_ERROR",
          }));
        history = await saveInvitationDeliveries({
          requestId: input.requestId,
          inviterEmail: viewer.email,
          trip: plan.trip,
          subject: input.subject,
          deliveries,
        });
        throw deliveryError;
      }
      history = await saveInvitationDeliveries({
        requestId: input.requestId,
        inviterEmail: viewer.email,
        trip: plan.trip,
        subject: input.subject,
        deliveries: result.deliveries,
      });
      return Response.json({ sent: result.sent, skipped, history, quota }, { status: 201 });
    } catch (error) {
      if (error instanceof InvitationInputError || error instanceof ValidationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (error.code === "INVITATION_CONFIG_ERROR") {
        return Response.json({ error: "Dịch vụ gửi email chưa được cấu hình" }, { status: 503 });
      }
      if (error.code === "INVITATION_AUTH_ERROR") {
        return Response.json({
          error: "Hãy kết nối lại Gmail để tiếp tục gửi lời rủ.",
          code: "GMAIL_AUTH_REQUIRED",
          history,
          quota,
        }, { status: 403 });
      }
      if (error instanceof InvitationRateLimitError) {
        return Response.json({
          error: "Bạn đã dùng 20 lượt gửi trong 24 giờ.",
          code: "INVITATION_RATE_LIMIT",
          quota: error.quota,
        }, { status: 429 });
      }
      if (error instanceof InvitationPermissionError && error.code === "REQUEST_ID_CONFLICT") {
        return Response.json({ error: error.message }, { status: 409 });
      }
      if (error.code === "INVITATION_DELIVERY_ERROR") {
        const sent = history.filter((delivery) => delivery.status === "sent").length;
        const failed = history.filter((delivery) => delivery.status === "failed").length;
        const errorMessage = sent
          ? `Đã gửi ${sent} lời rủ; ${failed} email gửi lỗi. Kiểm tra lịch sử bên dưới trước khi thử lại.`
          : "Không thể gửi lời rủ lúc này. Vui lòng thử lại.";
        return Response.json({ error: errorMessage, history, quota }, { status: 502 });
      }
      if (error.code === "TRIP_NOT_FOUND") {
        return Response.json({ error: "Chuyến đi đã chọn không còn tồn tại" }, { status: 404 });
      }
      return Response.json({ error: "Không thể gửi lời rủ lúc này" }, { status: 500 });
    }
  }
}
