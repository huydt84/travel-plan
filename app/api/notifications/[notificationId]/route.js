import { NextResponse } from "next/server";
import { apiError } from "../../../../lib/api-response";
import { requireAuthenticated } from "../../../../lib/auth";
import { markNotificationRead } from "../../../../lib/notification-repository";
import { ValidationError } from "../../../../lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const idFrom = (value) => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new ValidationError("notificationId must be a positive integer");
  return value;
};

export async function PATCH(_request, context) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  const { notificationId } = await context.params;
  try {
    return NextResponse.json(await markNotificationRead({
      notificationId: idFrom(notificationId),
      recipientEmail: viewer.email,
    }));
  } catch (error) {
    return apiError(error);
  }
}
