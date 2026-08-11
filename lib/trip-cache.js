import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { getItinerary, listTrips } from "./itinerary-repository";
import { resolveLocalAdminMode } from "./runtime-config.mjs";

const cacheNamespace = resolveLocalAdminMode().enabled ? "local-admin" : "default";
export const TRAVEL_PLANS_CACHE_TAG = `travel-plans:${cacheNamespace}`;

export const listCachedTrips = unstable_cache(
  listTrips,
  ["travel-plans", cacheNamespace, "list"],
  { tags: [TRAVEL_PLANS_CACHE_TAG], revalidate: 300 },
);

export const getCachedItinerary = unstable_cache(
  async (slug) => getItinerary(slug),
  ["travel-plans", cacheNamespace, "itinerary"],
  { tags: [TRAVEL_PLANS_CACHE_TAG], revalidate: 300 },
);

export function expireTravelPlansCache() {
  revalidateTag(TRAVEL_PLANS_CACHE_TAG, { expire: 0 });
}
