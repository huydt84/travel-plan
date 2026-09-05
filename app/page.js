import TripTracker from "../components/TripTracker";
import { getViewer } from "../lib/auth";
import { getCachedItinerary, listCachedTrips } from "../lib/trip-cache";
import { currentDateInTimezone } from "../lib/trip-dates.mjs";

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
      key={itinerary.trip.slug}
      initialData={itinerary}
      initialNow={new Date().getTime()}
      initialInvitationOpen={invite === "1"}
      initialGmailReturn={["return", "cancel"].includes(gmail)}
      viewer={viewer}
      trips={trips}
    />
  );
}

export const preferredTripSlug = (trips, now = new Date()) => {
  if (!trips.length) return "sample-trip";
  const dated = trips.map((trip) => ({ ...trip, today: currentDateInTimezone(now, trip.timezone) }));
  const ongoing = dated.filter((trip) => trip.startDate <= trip.today && trip.endDate >= trip.today)
    .sort((left, right) => right.startDate.localeCompare(left.startDate));
  if (ongoing[0]) return ongoing[0].slug;
  const upcoming = dated.filter((trip) => trip.startDate > trip.today)
    .sort((left, right) => left.startDate.localeCompare(right.startDate));
  if (upcoming[0]) return upcoming[0].slug;
  return [...dated].sort((left, right) => right.endDate.localeCompare(left.endDate))[0].slug;
};
