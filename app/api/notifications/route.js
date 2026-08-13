import { NextResponse } from "next/server";
import { apiError } from "../../../lib/api-response";
import { requireAuthenticated } from "../../../lib/auth";
import { listNotifications } from "../../../lib/notification-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { viewer, response } = await requireAuthenticated();
  if (response) return response;

  const url = new URL(request.url);
  try {
    return NextResponse.json(await listNotifications({
      recipientEmail: viewer.email,
      cursor: url.searchParams.get("cursor"),
      limit: url.searchParams.get("limit"),
    }));
  } catch (error) {
    return apiError(error);
  }
}
