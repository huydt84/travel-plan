import TripTracker from "../components/TripTracker";
import TripAccessState from "../components/TripAccessState";
import { getViewer } from "../lib/auth";
import { getCachedItinerary } from "../lib/trip-cache";
import { currentDateInTimezone } from "../lib/trip-dates.mjs";
import { listVisibleTrips, requireTripAccess } from "../lib/trip-access-repository";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()]);
  if (!viewer) return <TripAccessState state="signed-out" />;
  const trips = await listVisibleTrips(viewer);
  const { trip: requestedTrip, invite, gmail } = params;
  if (typeof requestedTrip === "string" && !trips.some((trip) => trip.slug === requestedTrip)) notFound();
  if (!trips.length) return <TripAccessState state="empty" viewer={viewer} />;
  const requestedSlug = typeof requestedTrip === "string" && trips.some((trip) => trip.slug === requestedTrip)
    ? requestedTrip
    : null;
  const selectedSlug = requestedSlug || preferredTripSlug(trips);
  await requireTripAccess(viewer, selectedSlug, "view", { allowAdmin: false });
  let itinerary;
  try {
    itinerary = await getCachedItinerary(selectedSlug);
  } catch (error) {
    if (error.code === "TRIP_NOT_FOUND") notFound();
    throw error;
  }
  const selectedTrip = trips.find((trip) => trip.slug === selectedSlug);
  const access = {
    membershipRole: selectedTrip.membershipRole,
    canManage: selectedTrip.membershipRole === "leader",
    canManageMembers: selectedTrip.membershipRole === "leader",
    canSelectBranch: true,
    adminOverride: false,
  };
  return (
    <TripTracker
      key={itinerary.trip.slug}
      initialData={itinerary}
      initialNow={new Date().getTime()}
      initialInvitationOpen={invite === "1"}
      initialGmailReturn={["return", "cancel"].includes(gmail)}
      viewer={viewer}
      trips={trips}
      access={access}
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
