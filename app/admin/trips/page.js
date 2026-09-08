import AdminApp from "../../../components/AdminApp";
import { getViewer } from "../../../lib/auth";
import { listSuggestions } from "../../../lib/suggestion-repository";
import { countPendingInvitationRequests } from "../../../lib/invitation-permission-repository";
import { getItinerary, listTrips } from "../../../lib/itinerary-repository";
import { countOpenTripRequests } from "../../../lib/trip-request-repository";

import { localizedMetadata } from "../../../lib/locale-server";
export const generateMetadata = () => localizedMetadata("metadata.adminTrips");
export const dynamic = "force-dynamic";

export default async function TripsAdminPage({ searchParams }) {
  const viewer = await getViewer();
  let initialTrips = [];
  let initialSelectedSlug = "";
  let initialPlan = null;
  let initialSuggestions = [];
  let pendingInvitationCount = 0;
  let pendingTripRequestCount = 0;

  if (viewer?.isAdmin) {
    const [{ trip: requestedTrip }, trips, invitationCount, requestCount] = await Promise.all([
      searchParams,
      // Management must not open a cached trip deleted by another process.
      listTrips(),
      countPendingInvitationRequests(),
      countOpenTripRequests(),
    ]);
    initialTrips = trips;
    pendingInvitationCount = invitationCount;
    pendingTripRequestCount = requestCount;
    initialSelectedSlug = typeof requestedTrip === "string" && initialTrips.some((trip) => trip.slug === requestedTrip)
      ? requestedTrip
      : initialTrips[0]?.slug || "";
    if (initialSelectedSlug) {
      [initialPlan, initialSuggestions] = await Promise.all([
        getItinerary(initialSelectedSlug),
        listSuggestions(initialSelectedSlug, viewer),
      ]);
    }
  }

  return (
    <AdminApp
      viewer={viewer}
      initialTrips={initialTrips}
      initialSelectedSlug={initialSelectedSlug}
      initialPlan={initialPlan}
      initialSuggestions={initialSuggestions}
      pendingInvitationCount={pendingInvitationCount}
      pendingTripRequestCount={pendingTripRequestCount}
    />
  );
}
