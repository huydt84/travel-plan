import AdminApp from "../../../components/AdminApp";
import PlaceCollectionsApp from "../../../components/PlaceCollectionsApp";
import { getViewer } from "../../../lib/auth";
import { localizedMetadata } from "../../../lib/locale-server";
import { createPlaceCollectionRepository } from "../../../lib/place-collections/repository.mjs";
import { countPendingInvitationRequests } from "../../../lib/invitation-permission-repository";
import { countOpenTripRequests } from "../../../lib/trip-request-repository";

export const generateMetadata = () => localizedMetadata("metadata.adminCollections");
export const dynamic = "force-dynamic";

export default async function CollectionsPage({ searchParams }) {
  const viewer = await getViewer();
  if (!viewer?.isAdmin) return <AdminApp viewer={viewer} initialTrips={[]} initialSelectedSlug="" initialPlan={null} initialSuggestions={[]} />;
  const repository = createPlaceCollectionRepository();
  const [collections, invitationCount, requestCount, params] = await Promise.all([
    repository.list(), countPendingInvitationRequests(), countOpenTripRequests(), searchParams,
  ]);
  const selectedId = typeof params.collection === "string" && collections.some((item) => item.id === params.collection)
    ? params.collection : collections.find((item) => !item.archived)?.id || collections[0]?.id || null;
  const selected = selectedId ? await repository.get(selectedId) : null;
  return <PlaceCollectionsApp viewer={viewer} initialCollections={collections} initialSelected={selected}
    pendingInvitationCount={invitationCount} pendingTripRequestCount={requestCount} />;
}
