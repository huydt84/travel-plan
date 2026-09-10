import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createPlaceCollectionRepository } from "../../lib/place-collections/repository.mjs";
import { createContextService } from "../../lib/v1/context.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

const actor = { email: "local-admin@localhost.invalid", isAdmin: true };
const place = (position, name, tuple, updated = "2030-01-01T00:00:00.000Z") => ({ position,name,address:`${name} address`,latitude:35+position/10,longitude:139+position/10,note:`Note for ${name}`,
  mapsUrl:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`,sourceCreatedAt:"2029-01-01T00:00:00.000Z",sourceUpdatedAt:updated,
  externalIds:[{kind:"feature_tuple",value:tuple},{kind:"knowledge_graph",value:`/g/${tuple.replace(":","")}`}] });
const snapshot = (externalId, items, title = "Tokyo field notes") => ({ provider:"google_maps",externalId,publicUrl:`https://www.google.com/maps/placelists/list/${externalId}`,
  title,description:"Places collected for a future route",parserVersion:"fixture-v1",sourceUpdatedAt:"2030-01-01T00:00:00.000Z",warnings:[],items });

async function fixture(initial) {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI), externalId = `test-${randomUUID()}`;
  let current = initial(externalId); const adapter = { provider:"google_maps",supports:()=>true,fetchSnapshot:async()=>current };
  const repository = createPlaceCollectionRepository({sql,adapter});
  return { sql,externalId,repository,setSnapshot:(value)=>{current=value;},close:async()=>{
    await sql`DELETE FROM place_collections WHERE external_list_id=${externalId}`;
    await sql`DELETE FROM place_library_entries p WHERE NOT EXISTS(SELECT 1 FROM place_collection_items i WHERE i.place_id=p.id)`;
    await sql.end();
  } };
}

test("collection sync is atomic, archives removals, restores places and preserves local hiding", async () => {
  const f = await fixture((id)=>snapshot(id,[place(0,"A","1:1"),place(1,"B","2:2")]));
  try {
    const first = await f.repository.createPreview({actor,url:"https://maps.app.goo.gl/example"});
    expect(first.summary).toMatchObject({added:2,removed:0});
    const receipt = await f.repository.applyPreview(first.id,actor.email,first.digest);
    const repeated = await f.repository.applyPreview(first.id,actor.email,first.digest); expect(repeated).toEqual(receipt);
    let collection = await f.repository.get(receipt.collectionId); const hiddenId = collection.items[0].id;
    await f.repository.setPlaceHidden(collection.id,hiddenId,true);
    f.setSnapshot(snapshot(f.externalId,[place(0,"A revised","1:1","2031-01-01T00:00:00.000Z")]));
    const second = await f.repository.createPreview({actor,collectionId:collection.id}); expect(second.summary).toMatchObject({updated:1,removed:1});
    await f.repository.applyPreview(second.id,actor.email,second.digest); collection = await f.repository.get(collection.id);
    expect(collection.items.find((item)=>item.id===hiddenId).hiddenAt).toBeTruthy(); expect(collection.items.filter((item)=>item.sourceRemovedAt)).toHaveLength(1);
    f.setSnapshot(snapshot(f.externalId,[place(0,"A revised","1:1"),place(1,"B","2:2")]));
    const third = await f.repository.createPreview({actor,collectionId:collection.id}); expect(third.summary.restored).toBe(1);
    await f.repository.applyPreview(third.id,actor.email,third.digest);
    const context = createContextService({sql:f.sql}); const found = await context.search(actor,{query:"Tokyo field",kind:"collection"});
    expect(found.items[0].ref.kind).toBe("collection"); const read = await context.read(actor,found.items[0].ref); expect(read.content.places).toHaveLength(1);
    const library = await context.search(actor,{query:"B address",kind:"place"}); expect(library.items[0].ref.id).toMatch(/^library:/);
  } finally { await f.close(); }
});

for (const [width,height] of [[320,760],[1440,900],[1920,1080]]) test(`collection preview and apply remain usable at ${width}`, async ({page}) => {
  const f = await fixture((id)=>snapshot(id,[place(0,"Kiyosumi Garden","8:8")]));
  try {
    const preview = await f.repository.createPreview({actor,url:"https://maps.app.goo.gl/example"});
    await page.route("**/api/admin/place-collections/sync-previews", async (route) => route.fulfill({status:201,contentType:"application/json",body:JSON.stringify(preview)}));
    await page.setViewportSize({width,height}); await gotoHealthy(page,"/admin/collections");
    await page.getByLabel("Liên kết danh sách Google Maps").fill("https://maps.app.goo.gl/example"); await page.getByRole("button",{name:"Kiểm tra danh sách"}).click();
    await expect(page.getByText("Chưa có thay đổi nào được lưu.",{exact:false})).toBeVisible(); await expect(page.getByRole("heading",{name:"Kiyosumi Garden",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Áp dụng đồng bộ"}).click(); await expect(page.getByText("Đã đồng bộ bộ sưu tập.")).toBeVisible();
    await expect(page.getByRole("heading",{name:"Tokyo field notes"})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  } finally { await f.close(); }
});
