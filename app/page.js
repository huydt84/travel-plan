import TripTracker from "../components/TripTracker";
import { getViewer } from "../lib/auth";
import { getCachedItinerary, listCachedTrips } from "../lib/trip-cache";
import { currentDateInTimezone } from "../lib/trip-dates.mjs";
import { getItinerary, listTrips } from "../lib/itinerary-repository";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }) {
  const [params, cachedTrips, viewer] = await Promise.all([searchParams, listCachedTrips(), getViewer()]);
  let trips = cachedTrips;
  const { trip: requestedTrip, invite, gmail } = params;
  const requestedSlug = typeof requestedTrip === "string" && trips.some((trip) => trip.slug === requestedTrip)
    ? requestedTrip
    : null;
  const selectedSlug = requestedSlug || preferredTripSlug(trips);
  let itinerary;
  try {
    itinerary = await getCachedItinerary(selectedSlug);
  } catch (error) {
    if (error.code !== "TRIP_NOT_FOUND") throw error;
    // Another server/importer may delete a trip without invalidating this
    // process's cached list. Recover from authoritative data, not the same cache.
    trips = await listTrips();
    if (!trips.length) notFound();
    const freshSlug = trips.some((trip) => trip.slug === requestedSlug) ? requestedSlug : preferredTripSlug(trips);
    try { itinerary = await getItinerary(freshSlug); }
    catch (freshError) {
      if (freshError.code === "TRIP_NOT_FOUND") notFound();
      throw freshError;
    }
  }
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
