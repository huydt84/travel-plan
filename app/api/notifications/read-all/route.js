import { NextResponse } from "next/server";
import { apiError } from "../../../../lib/api-response";
import { requireAuthenticated } from "../../../../lib/auth";
import { markAllNotificationsRead } from "../../../../lib/notification-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;
  try {
    return NextResponse.json(await markAllNotificationsRead(viewer.email));
  } catch (error) {
    return apiError(error);
  }
}
