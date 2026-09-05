import AdminApp from "../../../components/AdminApp";
import InvitationAdminApp from "../../../components/InvitationAdminApp";
import { getViewer } from "../../../lib/auth";
import { listInvitationHistory } from "../../../lib/invitation-repository";
import { listAllInvitationPermissions } from "../../../lib/invitation-permission-repository";
import { countOpenTripRequests } from "../../../lib/trip-request-repository";

export const metadata = { title: "Quản lý lời rủ" };
export const dynamic = "force-dynamic";

export default async function InvitationsAdminPage({ searchParams }) {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) {
    return <AdminApp viewer={viewer} initialTrips={[]} initialSelectedSlug="" initialPlan={null} initialSuggestions={[]} />;
  }
  const [{ view }, permissions, history, pendingTripRequestCount] = await Promise.all([
    searchParams,
    listAllInvitationPermissions(),
    listInvitationHistory(),
    countOpenTripRequests(),
  ]);
  return (
    <InvitationAdminApp
      viewer={viewer}
      initialPermissions={permissions}
      initialHistory={history}
      activeView={view === "history" ? "history" : "requests"}
      pendingTripRequestCount={pendingTripRequestCount}
    />
  );
}
