import { randomUUID } from "node:crypto";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

test("trip popup stays bounded, scrolls, and switches only on committed selection", async ({ page, request }, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const trips = Array.from({ length: 12 }, (_, index) => ({
    slug: `picker-${suffix}-${index}`,
    title: index === 11
      ? `Hành trình rất dài qua Tokyo, Kyoto, Osaka và nhiều địa điểm khác cùng bạn bè trong mùa thu Nhật Bản ${suffix}`
      : `Picker ${suffix} ${index}`,
  }));
  try {
    for (const trip of trips) {
      expect((await request.post("/api/trips", { data: {
        ...trip, startDate: "2030-04-01", endDate: "2030-04-01",
        timezone: "Asia/Tokyo", location: "Kyoto",
      } })).status()).toBe(201);
    }
    for (const viewport of [
      { width: 320, height: 760 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await gotoHealthy(page, `/?trip=${trips[0].slug}`);
      const trigger = page.getByRole("combobox", { name: "Chọn chuyến đi" });
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      const popup = page.locator('[data-radix-popper-content-wrapper] [role="listbox"]');
      await expect(popup).toBeVisible();
      const geometry = await popup.evaluate((element) => {
        const popup = element.getBoundingClientRect();
        const trigger = document.querySelector('#trip-picker-select').getBoundingClientRect();
        return {
          top: popup.top, bottom: popup.bottom, left: popup.left, right: popup.right,
          width: popup.width, height: popup.height, triggerBottom: trigger.bottom,
          triggerRight: trigger.right, scrollHeight: element.querySelector('[class*="trip-picker-options"]').scrollHeight,
        };
      });
      expect(geometry.top).toBeGreaterThanOrEqual(geometry.triggerBottom + 4);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(viewport.width);
      expect(geometry.bottom).toBeLessThanOrEqual(viewport.height);
      expect(Math.abs(geometry.right - geometry.triggerRight)).toBeLessThanOrEqual(13);
      if (viewport.width >= 1440) expect(geometry.width).toBeGreaterThanOrEqual(480);
      expect(geometry.scrollHeight).toBeGreaterThan(geometry.height);
      const appearance = await popup.evaluate((element) => ({
        fontSize: getComputedStyle(element).fontSize,
        background: getComputedStyle(element).backgroundColor,
      }));
      expect(appearance.fontSize).toBe("16px");
      expect(appearance.background).toBe("rgb(255, 253, 247)");
      await page.screenshot({ path: testInfo.outputPath(`open-trip-picker-${viewport.width}.png`) });
      await page.keyboard.press("ArrowDown");
      await expect(page.locator("#trip-picker-select")).toHaveAttribute("data-trip-slug", trips[0].slug);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("data-trip-slug", trips[0].slug);
      await trigger.click();
      await page.mouse.click(4, viewport.height - 4);
      await expect(popup).toHaveCount(0);
      await expect(trigger).toHaveAttribute("data-trip-slug", trips[0].slug);
      await trigger.click();
      const longOption = page.getByRole("option", { name: new RegExp(`Hành trình rất dài.*${suffix}$`) });
      await longOption.scrollIntoViewIfNeeded();
      const wraps = await longOption.evaluate((element) => {
        return { height: element.getBoundingClientRect().height, overflow: element.scrollWidth - element.clientWidth };
      });
      expect(wraps.height).toBeGreaterThan(44);
      expect(wraps.overflow).toBeLessThanOrEqual(0);
      await longOption.click();
      await expect(page).toHaveURL(new RegExp(`trip=${trips[11].slug}`));
      await expect(trigger).toHaveAttribute("data-trip-slug", trips[11].slug);
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect(page.locator("#trip-picker-select")).toHaveAttribute("data-trip-slug", trips[11].slug);
      await page.keyboard.press("End");
      await expect.poll(async () => page.locator('[role="option"][data-highlighted]').allTextContents())
        .not.toContain(trips[11].title);
      await page.keyboard.press("Enter");
      await expect(trigger).toBeFocused();
      await expect(trigger).not.toHaveAttribute("data-trip-slug", trips[11].slug);
    }
  } finally {
    for (const trip of trips) await request.delete(`/api/trips/${trip.slug}`);
  }
});

test("trip popup flips above only when the trigger is near the lower edge", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoHealthy(page, "/");
  await page.locator(".trip-picker").evaluate((element) => {
    element.style.transform = "translateY(600px)";
  });
  const trigger = page.getByRole("combobox", { name: "Chọn chuyến đi" });
  await trigger.click();
  const popup = page.getByRole("listbox");
  await expect(popup).toHaveAttribute("data-side", "top");
  const bounds = await popup.evaluate((element) => ({
    popup: element.getBoundingClientRect().toJSON(),
    trigger: document.querySelector("#trip-picker-select").getBoundingClientRect().toJSON(),
  }));
  expect(bounds.popup.bottom).toBeLessThanOrEqual(bounds.trigger.top - 4);
  expect(bounds.popup.top).toBeGreaterThanOrEqual(0);
});
