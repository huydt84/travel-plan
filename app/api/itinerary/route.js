import { NextResponse } from "next/server";
import { getCachedItinerary } from "../../../lib/trip-cache";
import { getViewer } from "../../../lib/auth";
import { listVisibleTrips, requireTripAccess } from "../../../lib/trip-access-repository";
import { apiError } from "../../../lib/api-response";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const requestedSlug = new URL(request.url).searchParams.get("slug");
  const viewer = await getViewer();

  try {
    const slug = requestedSlug || (await listVisibleTrips(viewer))[0]?.slug;
    if (!slug) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    await requireTripAccess(viewer, slug, "view", { allowAdmin: false });
    const itinerary = await getCachedItinerary(slug);
    return NextResponse.json(itinerary);
  } catch (error) {
    return apiError(error);
  }
}
