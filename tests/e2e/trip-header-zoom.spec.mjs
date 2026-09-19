import { expect, gotoHealthy, itineraryTest as test } from "./fixtures.mjs";

test("trip header controls do not overlap at a zoom-compressed desktop width", async ({ page }) => {
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 768 });
    await gotoHealthy(page, "/");

    const header = page.locator("header#top");
    await expect(header).toBeVisible();

  const collisions = await header.locator("a, button, select").evaluateAll((controls) => {
    const visible = controls.filter((control) => {
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });

    return visible.flatMap((control, index) => {
      const first = control.getBoundingClientRect();
      return visible.slice(index + 1).flatMap((other) => {
        const second = other.getBoundingClientRect();
        const overlapWidth = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const overlapHeight = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        if (overlapWidth <= 1 || overlapHeight <= 1) return [];
        const name = (element) => element.getAttribute("aria-label") || element.labels?.[0]?.textContent.trim() || element.textContent.trim() || element.tagName;
        return [`${name(control)} overlaps ${name(other)}`];
      });
    });
  });

    expect(collisions, `every top-bar control must remain independently usable at ${width}px`).toEqual([]);
  }
});

test("application and trip controls retain their actions on a narrow screen", async ({ page, tripSlug }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await gotoHealthy(page, "/");

  const appHeader = page.locator("header#top");
  const tripSection = page.locator(".trip-context");
  await expect(appHeader.getByRole("button", { name: "Trợ lý", exact: true })).toBeVisible();
  await expect(appHeader.getByRole("link", { name: "Quản lý", exact: true })).toHaveAttribute("href", /\/trips\/manage/);
  const shareButton = tripSection.getByRole("button", { name: "Chia sẻ" });
  await expect(shareButton).toBeVisible();
  await expect(shareButton.locator("svg.action-icon")).toBeVisible();
  await expect(tripSection.getByRole("button", { name: "Rủ bạn đi cùng" })).toBeVisible();
  await expect(tripSection.getByRole("button", { name: "Thành viên" })).toBeVisible();

  await appHeader.getByRole("button", { name: "Trợ lý", exact: true }).click();
  await expect(page.getByRole("region", { name: "Trợ lý hành trình", exact: true })).toBeVisible();
  await gotoHealthy(page, "/");

  await tripSection.getByRole("button", { name: "Chia sẻ" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await tripSection.getByRole("button", { name: "Rủ bạn đi cùng" }).click();
  await expect(page.getByRole("dialog", { name: /Rủ bạn đi/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await tripSection.getByRole("button", { name: "Thành viên" }).click();
  await expect(page.getByRole("dialog", { name: "Thành viên" })).toBeVisible();
  await page.keyboard.press("Escape");

  await tripSection.getByRole("combobox", { name: "Chọn chuyến đi" }).click();
  await page.getByRole("option", { name: /Fixture itinerary/ }).click();
  await expect(page).toHaveURL(new RegExp(`trip=${tripSlug}`));
  await expect(tripSection.getByRole("combobox", { name: "Chọn chuyến đi" })).toHaveAttribute("data-trip-slug", tripSlug);

  for (const locale of ["en", "ja"]) {
    await appHeader.getByTestId("language-switcher").selectOption(locale);
    await expect(appHeader.locator("nav button")).toBeVisible();
    await expect(appHeader.locator("nav a")).toBeVisible();
    await expect(tripSection.locator(".trip-context-actions button")).toHaveCount(3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${locale} header should not overflow at 320px`).toBeLessThanOrEqual(0);
  }

  await appHeader.locator("nav a").click();
  await expect(page).toHaveURL(new RegExp(`/trips/manage\\?trip=${tripSlug}`));
});

test("trip controls share the selector centerline and remain compact with a long title", async ({ page }) => {
  for (const width of [320, 680, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 320 ? 760 : 900 });
    await gotoHealthy(page, "/");
    const geometry = await page.locator(".trip-context").evaluate((context) => {
      const title = context.querySelector('[class*="trip-picker-title"]');
      title.textContent = "Chuyến hành trình rất dài qua nhiều thành phố và địa điểm cùng bạn bè trong mùa thu Nhật Bản";
      const picker = context.querySelector(".trip-picker-control");
      const actions = [...context.querySelectorAll(".trip-context-actions button")];
      const clock = context.querySelector(".live-clock");
      const digits = clock.querySelector("span:last-child");
      const digitStyle = getComputedStyle(digits);
      const box = (element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height, center: (rect.top + rect.bottom) / 2 };
      };
      return {
        picker: box(picker),
        actions: actions.map(box),
        clock: box(clock),
        digitSize: digitStyle.fontSize,
        digitWeight: digitStyle.fontWeight,
        digitVariant: digitStyle.fontVariantNumeric,
        backgrounds: actions.map((button) => getComputedStyle(button).backgroundColor),
        colors: actions.map((button) => getComputedStyle(button).color),
        weights: actions.map((button) => getComputedStyle(button).fontWeight),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const controlHeight = width <= 680 ? 44 : 40;
    expect(geometry.picker.height).toBe(controlHeight);
    expect(geometry.actions).toHaveLength(3);
    expect(geometry.actions.map(({ height }) => height)).toEqual([controlHeight, controlHeight, controlHeight]);
    expect(geometry.digitSize).toBe(width <= 680 ? "12px" : "20px");
    expect(geometry.digitWeight).toBe("600");
    expect(geometry.digitVariant).toContain("tabular-nums");
    expect(geometry.clock.height).toBeLessThanOrEqual(controlHeight);
    expect(new Set(geometry.backgrounds).size).toBe(1);
    expect(new Set(geometry.colors).size).toBe(1);
    expect(new Set(geometry.weights).size).toBe(1);
    expect(geometry.overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    if (width > 680) {
      for (const action of geometry.actions) {
        expect(Math.abs(action.center - geometry.picker.center), `action center at ${width}px`).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(geometry.clock.center - geometry.picker.center), `clock center at ${width}px`).toBeLessThanOrEqual(1);
      expect(geometry.actions[0].left).toBeGreaterThanOrEqual(geometry.picker.right);
      expect(geometry.clock.left).toBeGreaterThanOrEqual(geometry.actions[2].right);
    } else {
      expect(geometry.actions[0].top).toBeGreaterThanOrEqual(geometry.picker.bottom);
    }
  }
});
