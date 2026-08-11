import AdminApp from "../../../components/AdminApp";
import { getViewer } from "../../../lib/auth";
import { listSuggestions } from "../../../lib/suggestion-repository";
import { getCachedItinerary, listCachedTrips } from "../../../lib/trip-cache";

export const metadata = { title: "Quản lý lịch chuyến đi" };
export const dynamic = "force-dynamic";

export default async function TripsAdminPage() {
  const viewer = await getViewer();
  let initialTrips = [];
  let initialSelectedSlug = "";
  let initialPlan = null;
  let initialSuggestions = [];

  if (viewer?.isOwner) {
    initialTrips = await listCachedTrips();
    initialSelectedSlug = initialTrips[0]?.slug || "";
    if (initialSelectedSlug) {
      [initialPlan, initialSuggestions] = await Promise.all([
        getCachedItinerary(initialSelectedSlug),
        listSuggestions(initialSelectedSlug, viewer),
      ]);
    }
  }

  return (
    <AdminApp
      viewer={viewer}
      initialTrips={initialTrips}
      initialSelectedSlug={initialSelectedSlug}
      initialPlan={initialPlan}
      initialSuggestions={initialSuggestions}
    />
  );
}
