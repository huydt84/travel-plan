import { expect, permissionTest as test } from "./permission-fixture.mjs";

for (const viewport of [
  { name: "phone", width: 320, height: 760 },
  { name: "macbook", width: 1440, height: 900 },
  { name: "dell", width: 1920, height: 1080 },
]) {
  test(`switching a managed trip updates the shareable URL and survives reload on ${viewport.name}`, async ({ browser, request, permissionFixture: f }) => {
    const secondSlug = `managed-trip-url-${f.marker}`;
    const secondTitle = "Second managed trip";
    const created = await request.post("/api/trips", {
      headers: f.headers.leader,
      data: {
        slug: secondSlug,
        title: secondTitle,
        startDate: "2032-05-01",
        endDate: "2032-05-01",
        timezone: "Asia/Tokyo",
        location: "Kyoto",
      },
    });
    expect(created.status()).toBe(201);

    const context = await browser.newContext({
      viewport,
      extraHTTPHeaders: f.headers.leader,
    });
    const page = await context.newPage();

    try {
      await page.goto(`/trips/manage?trip=${f.slug}`);
      await expect(page.getByRole("heading", { name: "Permission matrix trip" })).toBeVisible();

      await page.getByRole("button", { name: new RegExp(secondTitle) }).click();
      await expect(page).toHaveURL(new RegExp(`[?&]trip=${secondSlug}(?:&|$)`));
      await expect(page.getByRole("heading", { name: secondTitle })).toBeVisible();

      await page.reload();
      await expect(page).toHaveURL(new RegExp(`[?&]trip=${secondSlug}(?:&|$)`));
      await expect(page.getByRole("heading", { name: secondTitle })).toBeVisible();
    } finally {
      await context.close();
      await request.delete(`/api/trips/${secondSlug}`, { headers: f.headers.owner });
    }
  });
}
