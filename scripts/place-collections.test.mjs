import assert from "node:assert/strict";
import test from "node:test";
import { CollectionImportError, createGoogleMapsCollectionAdapter, extractGetListUrl, parseEntityListResponse, validateGoogleMapsListUrl } from "../lib/place-collections/google-maps-adapter.mjs";

function entity({ count = 1, duplicate = false } = {}) {
  const item = (name, updated, profile) => {
    const core = []; core[4] = "1 Test Street"; core[5] = [null,null,35.1,139.2]; core[6] = ["123","456"]; core[7] = "/g/11test"; core[19] = "ChIJstable_test";
    const value = []; value[1] = core; value[2] = name; value[3] = "Trip note"; value[10] = [updated]; value[12] = profile;
    return value;
  };
  const root = []; root[0] = ["list-id"]; root[4] = "Tokyo ideas"; root[5] = "Public list";
  root[8] = duplicate ? [item("Older",1,{name:"Owner",avatar:"secret"}),item("Newer",2,{name:"Contributor"})] : [item("Place",1,{name:"Owner"})];
  root[12] = count;
  return `)]}'${JSON.stringify([root])}`;
}

test("Google list URLs are HTTPS and host allowlisted", () => {
  assert.equal(validateGoogleMapsListUrl("https://maps.app.goo.gl/example").hostname, "maps.app.goo.gl");
  for (const value of ["http://maps.app.goo.gl/example", "https://example.com/maps", "https://user@google.com/maps"])
    assert.throws(() => validateGoogleMapsListUrl(value), CollectionImportError);
});

test("preload discovery parses HTML and requests the verified maximum list size", () => {
  const url = extractGetListUrl('<html><head><link rel="preload" href="/maps/preview/entitylist/getlist?pb=!1m2!4i500!2sabc"></head></html>', "https://www.google.com/maps/placelists/list/test");
  assert.equal(url.pathname, "/maps/preview/entitylist/getlist");
  assert.match(url.searchParams.get("pb"), /!4i3000/);
});

test("normalized snapshots strip contributor data and deduplicate stable aliases", () => {
  const snapshot = parseEntityListResponse(entity({ count: 2, duplicate: true }), "https://maps.app.goo.gl/private-token");
  assert.equal(snapshot.items.length, 1); assert.equal(snapshot.items[0].name, "Newer"); assert.equal(snapshot.items[0].position, 0);
  assert.equal(snapshot.items[0].externalIds.find((id) => id.kind === "place_id").value, "ChIJstable_test");
  assert.equal(snapshot.items[0].externalIds.find((id) => id.kind === "knowledge_graph").value, "/g/11test");
  assert.equal(JSON.stringify(snapshot).includes("Owner"), false); assert.equal(JSON.stringify(snapshot).includes("Contributor"), false);
});

test("declared count mismatches reject incomplete snapshots", () => {
  assert.throws(() => parseEntityListResponse(entity({ count: 2 }), "https://www.google.com/maps/placelists/list/id"), (error) => error.code === "COLLECTION_INCOMPLETE");
});

test("indexed response normalizes typed IDs and removes contributor data", () => {
  const result = parseEntityListResponse(entity(), "https://maps.app.goo.gl/example");
  assert.equal(result.items[0].externalIds.find((id) => id.kind === "place_id").value, "ChIJstable_test");
  assert.equal(result.items[0].externalIds.find((id) => id.kind === "knowledge_graph").value, "/g/11test");
  assert.deepEqual(Object.keys(result.items[0]).sort(), ["address","externalIds","latitude","longitude","mapsUrl","name","note","position","sourceCreatedAt","sourceUpdatedAt"].sort());
  assert.doesNotMatch(JSON.stringify(result), /Owner|Contributor|avatar|secret/);
});

test("duplicates keep earliest position and latest source values", () => {
  const result = parseEntityListResponse(entity({ count: 2, duplicate: true }), "https://www.google.com/maps/placelists/list/test");
  assert.equal(result.items.length, 1); assert.equal(result.items[0].position, 0); assert.equal(result.items[0].name, "Newer");
  assert.deepEqual(result.warnings, [{ code: "DUPLICATE_PLACES", count: 1 }]);
});

test("count mismatches and unreadable formats are rejected", () => {
  assert.throws(() => parseEntityListResponse(entity({ count: 2 }), "https://www.google.com/maps"), (error) => error.code === "COLLECTION_INCOMPLETE");
  assert.throws(() => parseEntityListResponse("not-json", "https://www.google.com/maps"), (error) => error.code === "COLLECTION_FORMAT_CHANGED");
});

test("short links follow allowlisted redirects only", async () => {
  const calls = [];
  const adapter = createGoogleMapsCollectionAdapter({ fetchImpl: async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: "https://www.google.com/maps/placelists/list/test" } });
    if (calls.length === 2) return new Response('<link href="/maps/preview/entitylist/getlist?pb=!4i500">', { status: 200 });
    return new Response(entity(), { status: 200 });
  } });
  const result = await adapter.fetchSnapshot("https://maps.app.goo.gl/example");
  assert.equal(result.title, "Tokyo ideas"); assert.equal(calls.length, 3);
});
