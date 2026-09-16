import { NextResponse } from "next/server";
import { apiError } from "../../../../../../lib/api-response";
import { getViewer } from "../../../../../../lib/auth";
import { listTripAudit } from "../../../../../../lib/trip-audit-repository";
import { requireTripAccess } from "../../../../../../lib/trip-access-repository";

export const dynamic = "force-dynamic";

export async function GET(request, context) {
  const viewer = await getViewer();
  const { slug } = await context.params;
  try {
    if (!viewer?.isAdmin) {
      const error = new Error("Chỉ admin mới có quyền xem lịch sử hoạt động");
      error.code = "TRIP_FORBIDDEN";
      throw error;
    }
    await requireTripAccess(viewer, slug);
    const url = new URL(request.url);
    return NextResponse.json(await listTripAudit(slug, { cursor: url.searchParams.get("cursor"), limit: url.searchParams.get("limit") }));
  } catch (error) { return apiError(error); }
}
