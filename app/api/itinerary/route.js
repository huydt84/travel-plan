import { NextResponse } from "next/server";
import { getCachedItinerary, listCachedTrips } from "../../../lib/trip-cache";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const requestedSlug = new URL(request.url).searchParams.get("slug");

  try {
    const slug = requestedSlug || (await listCachedTrips())[0]?.slug;
    if (!slug) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    const itinerary = await getCachedItinerary(slug);
    return NextResponse.json(itinerary);
  } catch (error) {
    const status = error.code === "TRIP_NOT_FOUND" ? 404 : 503;
    return NextResponse.json(
      { error: status === 404 ? "Trip not found" : "Itinerary service unavailable" },
      { status },
    );
  }
}
