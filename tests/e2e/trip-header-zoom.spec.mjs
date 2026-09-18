import { expect, gotoHealthy, test } from "./fixtures.mjs";

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
