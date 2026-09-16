import AdminApp from "../../../components/AdminApp";
import { getViewer } from "../../../lib/auth";
import { getItinerary } from "../../../lib/itinerary-repository";
import { listSuggestions } from "../../../lib/suggestion-repository";
import { listLedTrips } from "../../../lib/trip-access-repository";

export const dynamic = "force-dynamic";

export default async function PersonalTripsPage({ searchParams }) {
  const viewer = await getViewer();
  let initialTrips = [];
  let initialSelectedSlug = "";
  let initialPlan = null;
  let initialSuggestions = [];
  const params = await searchParams;
  if (viewer) {
    initialTrips = await listLedTrips(viewer);
    initialSelectedSlug = typeof params.trip === "string" && initialTrips.some((trip) => trip.slug === params.trip)
      ? params.trip
      : initialTrips[0]?.slug || "";
    if (initialSelectedSlug) {
      [initialPlan, initialSuggestions] = await Promise.all([
        getItinerary(initialSelectedSlug),
        listSuggestions(initialSelectedSlug, { ...viewer, canManageTrip: true }),
      ]);
    }
  }
  return <AdminApp scope="personal" viewer={viewer} initialTrips={initialTrips} initialSelectedSlug={initialSelectedSlug}
    initialPlan={initialPlan} initialSuggestions={initialSuggestions} initialCreateOpen={params.create === "1"} />;
}
