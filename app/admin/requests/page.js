import AdminApp from "../../../components/AdminApp";
import TripRequestAdminApp from "../../../components/TripRequestAdminApp";
import { getViewer } from "../../../lib/auth";
import { countPendingInvitationRequests } from "../../../lib/invitation-permission-repository";
import { listCachedTrips } from "../../../lib/trip-cache";
import { listAllTripRequests } from "../../../lib/trip-request-repository";

import { localizedMetadata } from "../../../lib/locale-server";
export const generateMetadata = () => localizedMetadata("metadata.adminRequests");
export const dynamic = "force-dynamic";

export default async function TripRequestsAdminPage() {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) {
    return <AdminApp viewer={viewer} initialTrips={[]} initialSelectedSlug="" initialPlan={null} initialSuggestions={[]} />;
  }
  const [requests, trips, pendingInvitationCount] = await Promise.all([
    listAllTripRequests(),
    listCachedTrips(),
    countPendingInvitationRequests(),
  ]);
  return <TripRequestAdminApp viewer={viewer} initialRequests={requests} trips={trips} pendingInvitationCount={pendingInvitationCount} />;
}
