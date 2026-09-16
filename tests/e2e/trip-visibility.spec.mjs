import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

const asUser = (email, name) => ({ "x-local-viewer-email": email, "x-local-viewer-name": name });

test("membership authorization, atomic creation, transfer, and audit fail closed", async ({ request }) => {
  const marker = randomUUID();
  const leader = `leader-${marker}@example.com`;
  const member = `member-${marker}@example.com`;
  const second = `second-${marker}@example.com`;
  const outsider = `outsider-${marker}@example.com`;
  const slug = `visibility-${marker}`;
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  try {
    for (const [email, name] of [[leader, "Trip Leader"], [member, "Trip Member"], [second, "Second Member"], [outsider, "Outside User"]]) {
      expect((await request.get("/api/trips", { headers: asUser(email, name) })).status()).toBe(200);
    }
    const invalidSlug = `${slug}-invalid`;
    const invalid = await request.post("/api/trips", { headers: asUser(leader, "Trip Leader"), data: {
      slug: invalidSlug, title: "Must roll back", startDate: "2031-03-01", endDate: "2031-03-02", timezone: "Asia/Tokyo", location: "Tokyo",
      memberEmails: [member, `missing-${marker}@example.com`],
    } });
    expect(invalid.status()).toBe(400);
    expect((await sql`SELECT id FROM trips WHERE slug=${invalidSlug}`)).toHaveLength(0);

    const created = await request.post("/api/trips", { headers: asUser(leader, "Trip Leader"), data: {
      slug, title: "Private Kyoto", startDate: "2031-03-01", endDate: "2031-03-02", timezone: "Asia/Tokyo", location: "Kyoto", memberEmails: [member, second, member.toUpperCase()],
    } });
    expect(created.status()).toBe(201);
    const visibleToMember = await (await request.get("/api/trips", { headers: asUser(member, "Trip Member") })).json();
    const visibleToOutsider = await (await request.get("/api/trips", { headers: asUser(outsider, "Outside User") })).json();
    expect(visibleToMember.trips.some((trip) => trip.slug === slug)).toBe(true);
    expect(visibleToOutsider.trips.some((trip) => trip.slug === slug)).toBe(false);
    expect((await request.get(`/api/trips/${slug}`, { headers: asUser(outsider, "Outside User") })).status()).toBe(404);
    expect((await request.patch(`/api/trips/${slug}`, { headers: asUser(member, "Trip Member"), data: { title: "Forbidden" } })).status()).toBe(403);

    const memberList = await (await request.get(`/api/trips/${slug}/members`, { headers: asUser(member, "Trip Member") })).json();
    expect(memberList.members).toEqual(expect.arrayContaining([expect.objectContaining({ displayName: "Trip Leader", role: "leader" }), expect.objectContaining({ displayName: "Trip Member", role: "member" })]));
    expect(memberList.members.every((item) => !("email" in item))).toBe(true);
    const leaderList = await (await request.get(`/api/trips/${slug}/members`, { headers: asUser(leader, "Trip Leader") })).json();
    expect(leaderList.members).toEqual(expect.arrayContaining([expect.objectContaining({ email: member, role: "member" })]));
    expect((await request.delete(`/api/trips/${slug}/members/${encodeURIComponent(leader)}`, { headers: asUser(leader, "Trip Leader") })).status()).toBe(403);

    const transfers = await Promise.all([
      request.put(`/api/trips/${slug}/members/${encodeURIComponent(member)}/leader`, { headers: asUser(leader, "Trip Leader") }),
      request.put(`/api/trips/${slug}/members/${encodeURIComponent(second)}/leader`, { headers: asUser(leader, "Trip Leader") }),
    ]);
    expect(transfers.some((response) => response.status() === 200)).toBe(true);
    const [leaderCount] = await sql`SELECT COUNT(*)::INTEGER AS count FROM trip_participants participant JOIN trips trip ON trip.id=participant.trip_id WHERE trip.slug=${slug} AND participant.role='leader'`;
    expect(leaderCount.count).toBe(1);
    const audit = await (await request.get(`/api/admin/trips/${slug}/audit`)).json();
    expect(audit.events.map((event) => event.action)).toEqual(expect.arrayContaining(["trip.created", "leader.transferred"]));
  } finally {
    await request.delete(`/api/trips/${slug}`);
    await sql.end();
  }
});

for (const [width, height] of [[320, 760], [1440, 900], [1920, 1080]]) {
  test(`member sees private names and roles without management metadata at ${width}`, async ({ browser, request }) => {
    const marker = randomUUID();
    const leader = `ui-leader-${marker}@example.com`;
    const member = `ui-member-${marker}@example.com`;
    const slug = `ui-visibility-${marker}`;
    await request.get("/api/trips", { headers: asUser(leader, "UI Leader") });
    await request.get("/api/trips", { headers: asUser(member, "UI Member") });
    expect((await request.post("/api/trips", { headers: asUser(leader, "UI Leader"), data: {
      slug, title: "Member-only route", startDate: "2031-04-01", endDate: "2031-04-01", timezone: "Asia/Tokyo", location: "Osaka", memberEmails: [member],
    } })).status()).toBe(201);
    const context = await browser.newContext({ viewport: { width, height }, extraHTTPHeaders: asUser(member, "UI Member") });
    const page = await context.newPage();
    try {
      await gotoHealthy(page, `/?trip=${slug}`);
      await page.getByRole("button", { name: "Thành viên", exact: true }).click();
      const panel = page.getByRole("dialog", { name: "Thành viên" });
      await expect(panel).toContainText("UI Leader");
      await expect(panel).toContainText("Leader");
      await expect(panel).toContainText("UI Member");
      await expect(panel).not.toContainText(member);
      await expect(panel.getByRole("link", { name: "Quản lý thành viên" })).toHaveCount(0);
      if (width === 320) expect(await panel.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(320);
    } finally {
      await context.close();
      await request.delete(`/api/trips/${slug}`);
    }
  });
}
