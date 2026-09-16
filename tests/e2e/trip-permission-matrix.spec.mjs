import { expect, permissionTest as test } from "./permission-fixture.mjs";

const hasTrip = (body, slug) => body.trips.some((trip) => trip.slug === slug);

test("trip visibility and admin override follow the complete persona matrix", async ({ request, permissionFixture: f }) => {
  expect((await request.get("/dev/personas")).status()).toBe(404);
  expect((await request.get("/api/trips", { headers: f.headers.anonymous })).status()).toBe(401);
  for (const role of ["leader", "member"]) {
    const response = await request.get("/api/trips", { headers: f.headers[role] });
    expect(response.status()).toBe(200);
    expect(hasTrip(await response.json(), f.slug)).toBe(true);
    expect((await request.get(`/api/trips/${f.slug}`, { headers: f.headers[role] })).status()).toBe(200);
  }
  for (const role of ["owner", "admin", "outsider"]) {
    const response = await request.get("/api/trips", { headers: f.headers[role] });
    expect(response.status()).toBe(200);
    expect(hasTrip(await response.json(), f.slug)).toBe(false);
  }
  expect((await request.get(`/api/trips/${f.slug}`, { headers: f.headers.outsider })).status()).toBe(404);
  expect((await request.get(`/api/trips/${f.slug}`, { headers: f.headers.anonymous })).status()).toBe(401);
  for (const role of ["owner", "admin"]) {
    expect((await request.get(`/api/trips/${f.slug}`, { headers: f.headers[role] })).status()).toBe(200);
    const adminTrips = await request.get("/api/admin/trips", { headers: f.headers[role] });
    expect(adminTrips.status()).toBe(200);
    expect(hasTrip(await adminTrips.json(), f.slug)).toBe(true);
    expect((await request.get(`/api/admin/trips/${f.slug}/audit`, { headers: f.headers[role] })).status()).toBe(200);
  }
  for (const role of ["leader", "member", "outsider", "anonymous"]) {
    expect((await request.get("/api/admin/trips", { headers: f.headers[role] })).status()).toBe(role === "anonymous" ? 401 : 403);
  }
});

test("roster and lookup reveal only the metadata allowed to each persona", async ({ request, permissionFixture: f }) => {
  const memberRoster = await request.get(`/api/trips/${f.slug}/members`, { headers: f.headers.member });
  expect(memberRoster.status()).toBe(200);
  expect((await memberRoster.json()).members.every((member) => !("email" in member))).toBe(true);
  for (const role of ["leader", "owner", "admin"]) {
    const roster = await request.get(`/api/trips/${f.slug}/members`, { headers: f.headers[role] });
    expect(roster.status()).toBe(200);
    expect((await roster.json()).members.some((member) => member.email === f.people.member.email)).toBe(true);
  }
  expect((await request.get(`/api/trips/${f.slug}/members`, { headers: f.headers.outsider })).status()).toBe(404);
  expect((await request.post("/api/users/lookup", { headers: f.headers.anonymous, data: { email: f.people.member.email } })).status()).toBe(401);
  const lookup = await request.post("/api/users/lookup", { headers: f.headers.outsider, data: { email: f.people.member.email } });
  expect(lookup.status()).toBe(200);
  expect(await lookup.json()).toEqual({ email: f.people.member.email, displayName: f.people.member.name });
});

test("leader mutations reject member, outsider and anonymous before changing resources", async ({ request, permissionFixture: f }) => {
  const mutationCases = [
    ["schedule", `/api/trips/${f.slug}/schedule`, { startDate: "2032-04-01", start: "13:00", endDate: "2032-04-01", end: "14:00", type: "Visit", icon: "📍", title: "Permission schedule", detail: "", refs: [] }],
    ["source", `/api/trips/${f.slug}/sources`, { title: "Permission source", url: "https://example.com/permission" }],
    ["place", `/api/trips/${f.slug}/places`, { name: "Permission place", address: "Tokyo", notes: "", website: "https://example.com/place" }],
  ];
  for (const [, endpoint, data] of mutationCases) {
    expect((await request.post(endpoint, { headers: f.headers.anonymous, data })).status()).toBe(401);
    expect((await request.post(endpoint, { headers: f.headers.outsider, data })).status()).toBe(404);
    expect((await request.post(endpoint, { headers: f.headers.member, data })).status()).toBe(403);
    expect((await request.post(endpoint, { headers: f.headers.leader, data })).status()).toBe(201);
  }
  expect((await request.patch(`/api/trips/${f.slug}`, { headers: f.headers.member, data: { title: "Forbidden title" } })).status()).toBe(403);
  expect((await request.patch(`/api/trips/${f.slug}`, { headers: f.headers.admin, data: { title: "Admin override title" } })).status()).toBe(200);
  expect((await request.patch(`/api/trips/${f.slug}`, { headers: f.headers.owner, data: { title: "Owner override title" } })).status()).toBe(200);
});

test("membership, contributions and branch selection enforce their distinct capability levels", async ({ request, permissionFixture: f }) => {
  const addEndpoint = `/api/trips/${f.slug}/members`;
  const addData = { email: f.people.invitee.email };
  expect((await request.post(addEndpoint, { headers: f.headers.anonymous, data: addData })).status()).toBe(401);
  expect((await request.post(addEndpoint, { headers: f.headers.outsider, data: addData })).status()).toBe(404);
  expect((await request.post(addEndpoint, { headers: f.headers.member, data: addData })).status()).toBe(403);
  expect((await request.post(addEndpoint, { headers: f.headers.leader, data: addData })).status()).toBe(201);

  const suggestionEndpoint = `/api/trips/${f.slug}/suggestions`;
  expect((await request.post(suggestionEndpoint, { headers: f.headers.anonymous, data: { kind: "comment", body: "Anonymous comment" } })).status()).toBe(401);
  expect((await request.post(suggestionEndpoint, { headers: f.headers.outsider, data: { kind: "comment", body: "Outsider comment" } })).status()).toBe(404);
  expect((await request.post(suggestionEndpoint, { headers: f.headers.member, data: { kind: "comment", body: "Member comment" } })).status()).toBe(201);

  const branch = await request.post(`/api/trips/${f.slug}/branches`, { headers: f.headers.leader, data: {
    anchorActivityId: f.plan.backbone[0].id,
    segmentActivityIds: [f.plan.backbone[1].id],
    title: "Permission branch",
    defaultBranch: { key: `default-${f.marker}`, label: "Default", condition: "Normal" },
    alternateBranch: { key: `alternate-${f.marker}`, label: "Alternate", condition: "Changed" },
  } });
  expect(branch.status()).toBe(201);
  const group = (await branch.json()).branchGroups.find((item) => item.title === "Permission branch");
  const alternate = group.branches.find((item) => !item.isDefault);
  const selection = `/api/trips/${f.slug}/branches/${group.id}/selection`;
  expect((await request.put(selection, { headers: f.headers.anonymous, data: { branchId: alternate.id } })).status()).toBe(401);
  expect((await request.put(selection, { headers: f.headers.outsider, data: { branchId: alternate.id } })).status()).toBe(404);
  expect((await request.put(selection, { headers: f.headers.member, data: { branchId: alternate.id } })).status()).toBe(200);
  expect((await request.put(selection, { headers: f.headers.admin, data: { branchId: group.branches.find((item) => item.isDefault).id } })).status()).toBe(200);
});

for (const [width, height] of [[320, 760], [1440, 900], [1920, 1080]]) {
  test(`browser personas expose the correct surfaces at ${width}`, async ({ browser, permissionFixture: f }) => {
    const contexts = [];
    const open = async (role, path) => {
      const context = await browser.newContext({ viewport: { width, height }, extraHTTPHeaders: f.headers[role] });
      contexts.push(context);
      const page = await context.newPage();
      const response = await page.goto(path);
      return { page, response };
    };
    try {
      const anonymous = await open("anonymous", "/");
      await expect(anonymous.page.getByRole("heading", { name: "Lịch trình riêng của nhóm bạn" })).toBeVisible();
      const outsider = await open("outsider", "/");
      await expect(outsider.page.getByRole("heading", { name: "Chuyến đi tiếp theo bắt đầu từ đây" })).toBeVisible();
      expect((await outsider.page.goto(`/?trip=${f.slug}`)).status()).toBe(404);
      const member = await open("member", `/?trip=${f.slug}`);
      await expect(member.page.getByRole("button", { name: "Thành viên", exact: true })).toBeVisible();
      await expect(member.page.getByRole("link", { name: /Quản lý/ })).toHaveCount(0);
      const leader = await open("leader", `/trips/manage?trip=${f.slug}`);
      await expect(leader.page.getByRole("heading", { name: "Chuyến đi của tôi" })).toBeVisible();
      const admin = await open("admin", "/");
      await expect(admin.page.getByRole("heading", { name: "Chuyến đi tiếp theo bắt đầu từ đây" })).toBeVisible();
      await admin.page.goto(`/admin/trips?trip=${f.slug}`);
      await expect(admin.page.getByRole("heading", { name: "Quản lý lịch" })).toBeVisible();
      await expect(admin.page.getByRole("link", { name: "Test personas" })).toHaveCount(0);
      expect(await admin.page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    } finally { await Promise.all(contexts.map((context) => context.close())); }
  });
}
