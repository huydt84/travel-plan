import TripRequestApp from "../../components/TripRequestApp";
import { getViewer } from "../../lib/auth";
import { listOwnTripRequests } from "../../lib/trip-request-repository";

export const metadata = { title: "Yêu cầu chuyến đi" };
export const dynamic = "force-dynamic";

export default async function RequestsPage() {
  const viewer = await getViewer();
  const requests = viewer ? await listOwnTripRequests(viewer.email) : [];
  return <TripRequestApp viewer={viewer} initialRequests={requests} />;
}
