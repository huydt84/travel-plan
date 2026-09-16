import { NextResponse } from "next/server";
import { apiError } from "../../../../lib/api-response";
import { getViewer } from "../../../../lib/auth";
import { listAdminTrips } from "../../../../lib/trip-access-repository";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const viewer = await getViewer();
  const ownership = new URL(request.url).searchParams.get("ownership") || "all";
  try { return NextResponse.json({ trips: await listAdminTrips(viewer, { ownership }) }); }
  catch (error) { return apiError(error); }
}
