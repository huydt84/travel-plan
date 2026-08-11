import AdminApp from "../../../components/AdminApp";
import UserManagementApp from "../../../components/UserManagementApp";
import { getViewer } from "../../../lib/auth";
import { listCachedTrips } from "../../../lib/trip-cache";
import { listUsers } from "../../../lib/user-repository";

export const metadata = { title: "Quản lý người dùng" };
export const dynamic = "force-dynamic";

export default async function UsersAdminPage() {
  const viewer = await getViewer();
  if (!viewer?.isOwner) {
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

  const [users, trips] = await Promise.all([listUsers(), listCachedTrips()]);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const upcomingTrips = trips.filter((trip) => trip.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const initialTripSlug = (upcomingTrips[0] || trips[0])?.slug || "";

  return (
    <UserManagementApp
      viewer={viewer}
      users={users}
      trips={trips}
      initialTripSlug={initialTripSlug}
    />
  );
}
