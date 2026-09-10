import { parse } from "parse5";

export const GOOGLE_MAPS_PARSER_VERSION = "entitylist-v1";
const MAX_REDIRECTS = 5;
const HTML_LIMIT = 10 * 1024 * 1024;
const DATA_LIMIT = 25 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const browserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151 Safari/537.36";

export class CollectionImportError extends Error {
  constructor(code, message, { status = 422, details = null } = {}) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}

const allowed = (url) => {
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return host === "maps.app.goo.gl" || host === "www.google.com" || host === "maps.google.com" || host === "google.com" || (host === "goo.gl" && url.pathname.startsWith("/maps"));
};

export function validateGoogleMapsListUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new CollectionImportError("COLLECTION_URL_INVALID", "Google Maps URL is invalid", { status: 400 }); }
  if (!allowed(url)) throw new CollectionImportError("COLLECTION_URL_FORBIDDEN", "Only public HTTPS Google Maps list URLs are supported", { status: 400 });
  return url;
}

async function boundedText(response, limit, signal) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new CollectionImportError("COLLECTION_RESPONSE_TOO_LARGE", "Google Maps returned too much data");
  if (!response.body) return "";
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    signal?.throwIfAborted();
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new CollectionImportError("COLLECTION_RESPONSE_TOO_LARGE", "Google Maps returned too much data"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function fetchPage(input, fetchImpl, signal) {
  let current = validateGoogleMapsListUrl(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current, { redirect: "manual", signal, headers: { accept: "text/html" } });
    if ([301,302,303,307,308].includes(response.status)) {
      if (hop === MAX_REDIRECTS) throw new CollectionImportError("COLLECTION_REDIRECT_LIMIT", "Google Maps redirected too many times");
      const location = response.headers.get("location");
      if (!location) throw new CollectionImportError("COLLECTION_REDIRECT_INVALID", "Google Maps returned an invalid redirect");
      current = new URL(location, current); if (!allowed(current)) throw new CollectionImportError("COLLECTION_REDIRECT_FORBIDDEN", "Google Maps redirected outside an allowed host");
      continue;
    }
    if (!response.ok) throw new CollectionImportError(response.status === 404 ? "COLLECTION_NOT_PUBLIC" : "COLLECTION_FETCH_FAILED", "The public Google Maps list could not be opened", { status: response.status === 404 ? 404 : 502 });
    return { html: await boundedText(response, HTML_LIMIT, signal), finalUrl: current };
  }
}

function walk(node, visit) {
  visit(node); for (const child of node.childNodes || []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

export function extractGetListUrl(html, baseUrl) {
  let href = null;
  walk(parse(html), (node) => {
    if (href || node.nodeName !== "link") return;
    const attrs = Object.fromEntries((node.attrs || []).map((entry) => [entry.name, entry.value]));
    if (attrs.href?.includes("/maps/preview/entitylist/getlist")) href = attrs.href;
  });
  if (!href) throw new CollectionImportError("COLLECTION_FORMAT_CHANGED", "Google Maps list format is not recognized");
  const endpoint = new URL(href, baseUrl);
  if (!allowed(endpoint) || endpoint.pathname !== "/maps/preview/entitylist/getlist") throw new CollectionImportError("COLLECTION_ENDPOINT_FORBIDDEN", "Google Maps returned an unexpected data endpoint");
  const pb = endpoint.searchParams.get("pb");
  if (pb) endpoint.searchParams.set("pb", pb.replace(/!4i\d+/, "!4i3000"));
  return endpoint;
}

const string = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value) => Number.isFinite(value) ? value : null;
const instant = (tuple) => Array.isArray(tuple) && Number.isFinite(tuple[0]) ? new Date(tuple[0] * 1000).toISOString() : null;
const findPlaceId = (value) => {
  if (typeof value === "string" && /^ChIJ[A-Za-z0-9_-]+$/.test(value)) return value;
  if (!Array.isArray(value)) return null;
  for (const child of value) { const found = findPlaceId(child); if (found) return found; }
  return null;
};

export function parseEntityListResponse(raw, sourceUrl) {
  let data;
  try { data = JSON.parse(raw.replace(/^\)\]\}'\s*/, "")); }
  catch { throw new CollectionImportError("COLLECTION_FORMAT_CHANGED", "Google Maps returned unreadable list data"); }
  const root = data?.[0], rawItems = root?.[8];
  if (!Array.isArray(root) || !Array.isArray(rawItems) || !string(root?.[0]?.[0])) throw new CollectionImportError("COLLECTION_FORMAT_CHANGED", "Google Maps list format is not recognized");
  const parsed = rawItems.map((item, position) => {
    const core = item?.[1], tuple = Array.isArray(core?.[6]) ? core[6] : item?.[8]?.[1];
    const tupleParts = Array.isArray(tuple) ? tuple.slice(0,2).map((value) => String(value || "").trim()) : [];
    if (!Array.isArray(item) || !string(item[2]) || tupleParts.length !== 2 || tupleParts.some((value) => !/^\d+$/.test(value)))
      throw new CollectionImportError("COLLECTION_IDENTITY_MISSING", "A Google Maps place is missing its stable identity");
    const latitude = number(core?.[5]?.[2]), longitude = number(core?.[5]?.[3]);
    if ((latitude == null) !== (longitude == null) || (latitude != null && (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)))
      throw new CollectionImportError("COLLECTION_COORDINATES_INVALID", "A Google Maps place has invalid coordinates");
    const placeId = findPlaceId([core, item?.[19]]), knowledgeGraphId = string(core?.[7]);
    const externalIds = [{ kind: "feature_tuple", value: tupleParts.join(":") }];
    if (placeId) externalIds.push({ kind: "place_id", value: placeId });
    if (knowledgeGraphId && /^\/[gm]\//.test(knowledgeGraphId)) externalIds.push({ kind: "knowledge_graph", value: knowledgeGraphId });
    const query = placeId ? `query_place_id=${encodeURIComponent(placeId)}` : `query=${encodeURIComponent([item[2], string(core?.[4]) || string(core?.[2])].filter(Boolean).join(" "))}`;
    return { position, name: item[2].trim(), address: string(core?.[4]) || string(core?.[2]), latitude, longitude,
      note: string(item[3]) || "", mapsUrl: `https://www.google.com/maps/search/?api=1&${query}`,
      sourceCreatedAt: instant(item[9]), sourceUpdatedAt: instant(item[10]), externalIds };
  });
  const declaredCount = Number(root[12]);
  if (!Number.isInteger(declaredCount) || declaredCount < 0) throw new CollectionImportError("COLLECTION_FORMAT_CHANGED", "Google Maps list count is not recognized");
  if (declaredCount !== parsed.length) throw new CollectionImportError("COLLECTION_INCOMPLETE", "Google Maps returned an incomplete list", { details: { declaredCount, parsedCount: parsed.length } });
  const groups = new Set(), byIdentity = new Map(); let duplicateCount = 0;
  for (const item of parsed) {
    const keys = item.externalIds.map((id) => `${id.kind}:${id.value}`), priorGroups = [...new Set(keys.map((key) => byIdentity.get(key)).filter(Boolean))];
    if (!priorGroups.length) {
      groups.add(item); for (const key of keys) byIdentity.set(key, item); continue;
    }
    duplicateCount += 1;
    const candidates = [...priorGroups, item], newer = candidates.reduce((best, candidate) => (candidate.sourceUpdatedAt || "") > (best.sourceUpdatedAt || "") ? candidate : best);
    const merged = { ...newer, position: Math.min(...candidates.map((candidate) => candidate.position)),
      externalIds: [...new Map(candidates.flatMap((candidate) => candidate.externalIds).map((id) => [`${id.kind}:${id.value}`,id])).values()] };
    for (const prior of priorGroups) groups.delete(prior);
    groups.add(merged); for (const id of merged.externalIds) byIdentity.set(`${id.kind}:${id.value}`, merged);
  }
  const externalId = root[0][0];
  return { provider: "google_maps", externalId, sourceUrl, publicUrl: `https://www.google.com/maps/placelists/list/${encodeURIComponent(externalId)}`,
    title: string(root[4]) || "Google Maps list", description: string(root[5]) || "", parserVersion: GOOGLE_MAPS_PARSER_VERSION,
    sourceUpdatedAt: instant(root[11]), warnings: duplicateCount ? [{ code: "DUPLICATE_PLACES", count: duplicateCount }] : [],
    items: [...groups].sort((a,b) => a.position-b.position) };
}

export function createGoogleMapsCollectionAdapter({ fetchImpl = fetch } = {}) {
  return {
    provider: "google_maps",
    supports(value) { try { validateGoogleMapsListUrl(value); return true; } catch { return false; } },
    async fetchSnapshot(value, { signal } = {}) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      try {
        const page = await fetchPage(value, fetchImpl, combined); const endpoint = extractGetListUrl(page.html, page.finalUrl);
        const response = await fetchImpl(endpoint, { signal: combined, headers: { accept: "application/json,text/plain,*/*", "user-agent": browserAgent } });
        if (!response.ok) throw new CollectionImportError("COLLECTION_DATA_FETCH_FAILED", "Google Maps list data could not be loaded", { status: 502 });
        return parseEntityListResponse(await boundedText(response, DATA_LIMIT, combined), value);
      } catch (error) {
        if (error?.name === "AbortError") throw new CollectionImportError("COLLECTION_TIMEOUT", "Google Maps took too long to respond", { status: 504 });
        throw error;
      } finally { clearTimeout(timer); }
    },
  };
}
