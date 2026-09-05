import AdminApp from "../../../components/AdminApp";
import { getViewer } from "../../../lib/auth";
import { listSuggestions } from "../../../lib/suggestion-repository";
import { countPendingInvitationRequests } from "../../../lib/invitation-permission-repository";
import { getCachedItinerary, listCachedTrips } from "../../../lib/trip-cache";
import { countOpenTripRequests } from "../../../lib/trip-request-repository";

export const metadata = { title: "Quản lý lịch chuyến đi" };
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
      listCachedTrips(),
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
        getCachedItinerary(initialSelectedSlug),
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
