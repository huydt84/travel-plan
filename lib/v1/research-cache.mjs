import { createHash } from "node:crypto";

const hash = (provider, normalized) => createHash("sha256").update(`${provider}:${JSON.stringify(normalized)}`).digest("hex");

const ttlFor = (provider, args) => {
  if (provider === "place_details") return 14 * 86400_000;
  if (provider === "places_search") {
    if (args.openNow) return 1 * 86400_000;
    return 14 * 86400_000;
  }
  if (provider === "routes") {
    if (args.departureTime) return 6 * 3600_000;
    if (args.travelMode === "WALK" || args.travelMode === "BICYCLE") return 7 * 86400_000;
    return 1 * 86400_000;
  }
  return 7 * 86400_000;
};

const normalizeSearchPlaces = ({ query, latitude, longitude, openNow, languageCode }) => ({
  query: String(query || "").trim().toLowerCase(),
  latitude: latitude == null ? null : Math.round(Number(latitude) * 1e4) / 1e4,
  longitude: longitude == null ? null : Math.round(Number(longitude) * 1e4) / 1e4,
  openNow: Boolean(openNow),
  languageCode: String(languageCode || "vi").toLowerCase(),
});

const normalizePlaceDetails = ({ placeId, languageCode }) => ({
  placeId: String(placeId || "").replace(/^places\//, "").trim(),
  languageCode: String(languageCode || "vi").toLowerCase(),
});

const normalizeRoute = ({ origin, destination, travelMode, departureTime, timezone, languageCode }) => ({
  origin: origin?.placeId ? { placeId: String(origin.placeId).replace(/^places\//, "") } : { address: String(origin?.address || "").trim().toLowerCase() },
  destination: destination?.placeId ? { placeId: String(destination.placeId).replace(/^places\//, "") } : { address: String(destination?.address || "").trim().toLowerCase() },
  travelMode: String(travelMode || "TRANSIT").toUpperCase(),
  departureTime: departureTime ? String(departureTime) : null,
  timezone: String(timezone || "Asia/Tokyo"),
  languageCode: String(languageCode || "vi").toLowerCase(),
});

export function createCachedResearch({ research, sql = null, now = Date.now } = {}) {
  if (!research) return research;
  let getSql = sql;
  if (!getSql) {
    getSql = async (...args) => (await import("../db.js")).getSql()(...args);
  }
  const wrap = (provider, normalize, method) => async (args, opts) => {
    const normalized = normalize(args);
    const requestHash = hash(provider, normalized);
    const ttl = ttlFor(provider, normalized);
    try {
      const rows = await getSql`SELECT response, expires_at FROM google_research_cache WHERE provider=${provider} AND request_hash=${requestHash} AND expires_at > NOW() LIMIT 1`;
      if (rows.length) {
        const cached = rows[0].response;
        // Refresh checkedAt for display freshness without refetch.
        if (cached && typeof cached === "object" && "checkedAt" in cached) cached.checkedAt = new Date().toISOString();
        return { ...cached, _cached: true };
      }
    } catch { /* cache miss on error */ }
    const result = await research[method](args, opts);
    const expiresAt = new Date(now() + ttl).toISOString();
    try {
      await getSql`INSERT INTO google_research_cache (provider, request_hash, request, response, expires_at) VALUES (${provider}, ${requestHash}, ${JSON.stringify(normalized)}::JSONB, ${JSON.stringify(result)}::JSONB, ${expiresAt}::TIMESTAMPTZ) ON CONFLICT (request_hash) DO UPDATE SET response=EXCLUDED.response, expires_at=EXCLUDED.expires_at, fetched_at=NOW()`;
    } catch { /* best-effort */ }
    return { ...result, _cached: false };
  };
  return {
    ...research,
    searchPlaces: wrap("places_search", normalizeSearchPlaces, "searchPlaces"),
    getPlaceDetails: wrap("place_details", normalizePlaceDetails, "getPlaceDetails"),
    computeRoute: wrap("routes", normalizeRoute, "computeRoute"),
    // searchWeb is not cached (Gemini search; cheap to vary)
    searchWeb: research.searchWeb.bind(research),
  };
}
