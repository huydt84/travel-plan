import AdminApp from "../../../components/AdminApp";
import UserManagementApp from "../../../components/UserManagementApp";
import { getViewer } from "../../../lib/auth";
import { ownerEmail } from "../../../auth";
import { countPendingInvitationRequests } from "../../../lib/invitation-permission-repository";
import { listUsers } from "../../../lib/user-repository";
import { countOpenTripRequests } from "../../../lib/trip-request-repository";

export const metadata = { title: "Quản lý người dùng" };
export const dynamic = "force-dynamic";

export default async function UsersAdminPage() {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) {
    return (
      <AdminApp
        viewer={viewer}
        initialTrips={[]}
        initialSelectedSlug=""
        initialPlan={null}
        initialSuggestions={[]}
      />
    );
  }

  const [users, pendingInvitationCount, pendingTripRequestCount] = await Promise.all([
    listUsers({ ownerEmail: viewer.isOwner ? viewer.email : ownerEmail() }),
    countPendingInvitationRequests(),
    countOpenTripRequests(),
  ]);
  return <UserManagementApp viewer={viewer} users={users} pendingInvitationCount={pendingInvitationCount} pendingTripRequestCount={pendingTripRequestCount} />;
}
