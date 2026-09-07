import { GoogleGenAI } from "@google/genai";
import { DateTime } from "luxon";
import { safeSourceUrl } from "./evidence.mjs";
import { generationConfig } from "./assistant-policy.mjs";
import { AssistantFault } from "./errors.mjs";

const providerError = (provider, response) => new AssistantFault(
  "RESEARCH_UNAVAILABLE",
  `${provider} tạm thời không khả dụng`,
  { status: response?.status === 429 ? 429 : 502, retryable: response?.status === 429 || response?.status >= 500 },
);

const placeFields = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.currentOpeningHours",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
].join(",");

const detailFields = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "googleMapsUri",
  "businessStatus",
  "currentOpeningHours",
  "regularOpeningHours",
  "rating",
  "userRatingCount",
  "priceLevel",
  "reviews",
].join(",");

const mapsHeaders = (apiKey, fieldMask) => ({
  "content-type": "application/json",
  "x-goog-api-key": apiKey,
  "x-goog-fieldmask": fieldMask,
});

const placeSummary = (place, { includeReviews = false } = {}) => ({
  placeId: place.id,
  name: place.displayName?.text || "Địa điểm",
  address: place.formattedAddress || null,
  location: place.location || null,
  googleMapsUrl: place.googleMapsUri || null,
  businessStatus: place.businessStatus || null,
  openingHours: place.currentOpeningHours?.weekdayDescriptions || place.regularOpeningHours?.weekdayDescriptions || [],
  openNow: place.currentOpeningHours?.openNow ?? null,
  rating: place.rating ?? null,
  userRatingCount: place.userRatingCount ?? null,
  priceLevel: place.priceLevel || null,
  reviews: includeReviews ? (place.reviews || []).slice(0, 3).map((review) => ({
    rating: review.rating ?? null,
    relativeTime: review.relativePublishTimeDescription || null,
    text: review.text?.text?.slice(0, 700) || null,
    googleMapsUrl: review.googleMapsUri || null,
    author: review.authorAttribution?.displayName || null,
  })) : [],
});

export const extractSearchCitations = (interaction) => {
  const steps = interaction.outputs || interaction.steps || [];
  const citations = [];
  for (const step of steps) {
    if (step.type !== "model_output") continue;
    for (const block of step.content || []) {
      if (block.type !== "text") continue;
      for (const annotation of block.annotations || []) {
        if (annotation.type !== "url_citation" || !safeSourceUrl(annotation.url)) continue;
        citations.push({
          title: annotation.title || new URL(annotation.url).hostname,
          url: annotation.url,
          publisher: annotation.title || new URL(annotation.url).hostname,
        });
      }
    }
  }
  return [...new Map(citations.map((citation) => [citation.url, citation])).values()];
};

const waypoint = (value) => value.placeId
  ? { placeId: value.placeId.replace(/^places\//, "") }
  : { address: value.address };
const waypointLabel = (value) => value.address || value.placeId;
const mapsMode = { TRANSIT: "transit", WALK: "walking", DRIVE: "driving", BICYCLE: "bicycling" };

export function createGoogleResearchAdapters({ geminiApiKey, geminiModel, effort = "default", mapsApiKey, fetchImpl = fetch, searchClient = null, now = Date.now } = {}) {
  searchClient ||= geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
  const requireGemini = () => {
    if (!searchClient) throw new AssistantFault("PROVIDER_CONFIG", "Chưa cấu hình Gemini Search", { status: 503 });
  };
  const requireMaps = () => {
    if (!mapsApiKey) throw new AssistantFault("PROVIDER_CONFIG", "Chưa cấu hình Google Maps Platform", { status: 503 });
  };

  return {
    async searchWeb({ query }, { signal } = {}) {
      requireGemini();
      const interaction = await searchClient.interactions.create({
        model: geminiModel,
        ...generationConfig(effort),
        input: query,
        tools: [{ type: "google_search" }],
        system_instruction: "Research the user's travel question. Return concise factual text in the query language. Prefer official and primary sources.",
        store: false,
      }, { signal, timeout_ms: 40_000, maxRetries: 0 });
      return {
        summary: interaction.output_text || "Không tìm thấy kết quả phù hợp.",
        citations: extractSearchCitations(interaction),
        checkedAt: new Date().toISOString(),
      };
    },

    async searchPlaces({ query, latitude = null, longitude = null, openNow = false, languageCode = "vi" }, { signal } = {}) {
      requireMaps();
      const body = { textQuery: query, languageCode: languageCode || "vi", pageSize: 8 };
      if (latitude != null && longitude != null) {
        body.locationBias = { circle: { center: { latitude, longitude }, radius: 20_000 } };
      }
      if (openNow) body.openNow = true;
      const response = await fetchImpl("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: mapsHeaders(mapsApiKey, placeFields),
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) throw providerError("Google Places", response);
      const payload = await response.json();
      return { places: (payload.places || []).map((place) => placeSummary(place)), checkedAt: new Date().toISOString() };
    },

    async getPlaceDetails({ placeId, languageCode = "vi" }, { signal } = {}) {
      requireMaps();
      const normalizedId = placeId.replace(/^places\//, "");
      const response = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(normalizedId)}?languageCode=${encodeURIComponent(languageCode || "vi")}`, {
        headers: mapsHeaders(mapsApiKey, detailFields),
        signal,
      });
      if (!response.ok) throw providerError("Google Places", response);
      return { place: placeSummary(await response.json(), { includeReviews: true }), checkedAt: new Date().toISOString() };
    },

    async computeRoute({ origin, destination, travelMode = "TRANSIT", departureTime = null, timezone = "Asia/Tokyo", languageCode = "vi" }, { signal } = {}) {
      requireMaps();
      const body = {
        origin: waypoint(origin),
        destination: waypoint(destination),
        travelMode,
        languageCode: languageCode || "vi",
        units: "METRIC",
      };
      if (departureTime) {
        const departure = DateTime.fromISO(departureTime, { zone: timezone });
        if (!departure.isValid || !["TRANSIT", "DRIVE"].includes(travelMode)) {
          throw new AssistantFault("INVALID_INPUT", "Giờ khởi hành hoặc phương tiện không hợp lệ");
        }
        const delta = departure.toMillis() - now();
        if ((travelMode === "TRANSIT" && (delta < -7 * 86400000 || delta > 100 * 86400000)) ||
            (travelMode === "DRIVE" && delta < 0)) {
          throw new AssistantFault("ROUTE_DATE_UNAVAILABLE", "Ngày đi nằm ngoài khoảng dự báo tuyến; không được coi tuyến hiện tại là tuyến cho ngày đó");
        }
        body.departureTime = departure.toUTC().toISO();
      }
      const fieldMask = [
        "routes.duration",
        "routes.distanceMeters",
        "routes.description",
        "routes.localizedValues",
        "routes.legs.steps.travelMode",
        "routes.legs.steps.navigationInstruction",
        "routes.legs.steps.transitDetails",
      ].join(",");
      const response = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: mapsHeaders(mapsApiKey, fieldMask),
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) throw providerError("Google Routes", response);
      const payload = await response.json();
      const mapsQuery = new URLSearchParams({ api: "1", origin: waypointLabel(origin), destination: waypointLabel(destination), travelmode: mapsMode[travelMode] });
      if (origin.placeId) mapsQuery.set("origin_place_id", waypoint(origin).placeId);
      if (destination.placeId) mapsQuery.set("destination_place_id", waypoint(destination).placeId);
      return {
        routes: (payload.routes || []).slice(0, 3).map((route) => ({
          duration: route.duration || null, distanceMeters: route.distanceMeters ?? null,
          description: route.description || null,
          steps: (route.legs || []).flatMap((leg) => (leg.steps || []).map((step) => ({
            travelMode: step.travelMode, instruction: step.navigationInstruction?.instructions || null,
            transit: step.transitDetails ? {
              departureStop: step.transitDetails.stopDetails?.departureStop?.name,
              arrivalStop: step.transitDetails.stopDetails?.arrivalStop?.name,
              line: step.transitDetails.transitLine?.name,
            } : null,
          }))),
        })),
        googleMapsUrl: `https://www.google.com/maps/dir/?${mapsQuery}`,
        checkedAt: new Date().toISOString(),
      };
    },
  };
}
