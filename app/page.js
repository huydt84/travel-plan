import TripTracker from "../components/TripTracker";
import { getViewer } from "../lib/auth";
import { getCachedItinerary, listCachedTrips } from "../lib/trip-cache";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }) {
  const [params, trips, viewer] = await Promise.all([searchParams, listCachedTrips(), getViewer()]);
  const { trip: requestedTrip, invite, gmail } = params;
  const requestedSlug = typeof requestedTrip === "string" && trips.some((trip) => trip.slug === requestedTrip)
    ? requestedTrip
    : null;
  const selectedSlug = requestedSlug || preferredTripSlug(trips);
  const itinerary = await getCachedItinerary(selectedSlug);
  return (
    <TripTracker
      initialData={itinerary}
      initialNow={new Date().getTime()}
      initialInvitationOpen={invite === "1"}
      initialGmailReturn={["return", "cancel"].includes(gmail)}
      viewer={viewer}
      trips={trips}
    />
  );
}

const preferredTripSlug = (trips) => {
  if (!trips.length) return "sample-trip";
  const today = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const date = `${today.year}-${today.month}-${today.day}`;
  const upcoming = trips.filter((trip) => trip.date >= date).sort((a, b) => a.date.localeCompare(b.date));
  return (upcoming[0] || trips[0]).slug;
};
