import AdminApp from "../../../components/AdminApp";
import InvitationAdminApp from "../../../components/InvitationAdminApp";
import { getViewer } from "../../../lib/auth";
import { listInvitationHistory } from "../../../lib/invitation-repository";
import { listAllInvitationPermissions } from "../../../lib/invitation-permission-repository";

export const metadata = { title: "Quản lý lời rủ" };
export const dynamic = "force-dynamic";

export default async function InvitationsAdminPage({ searchParams }) {
  const viewer = await getViewer();
  if (!viewer?.isOwner) {
    return <AdminApp viewer={viewer} initialTrips={[]} initialSelectedSlug="" initialPlan={null} initialSuggestions={[]} />;
  }
  const [{ view }, permissions, history] = await Promise.all([
    searchParams,
    listAllInvitationPermissions(),
    listInvitationHistory(),
  ]);
  return (
    <InvitationAdminApp
      viewer={viewer}
      initialPermissions={permissions}
      initialHistory={history}
      activeView={view === "history" ? "history" : "requests"}
    />
  );
}
