import { expect, gotoHealthy, test } from "./fixtures.mjs";

const viewports = [
  { name: "phone", width: 320, height: 760, touch: true },
  { name: "macbook", width: 1440, height: 900, touch: false },
  { name: "dell", width: 1920, height: 1080, touch: false },
];

const surfaces = [
  {
    name: "public tracker",
    path: "/",
    ready: (page) => page.getByRole("combobox", { name: "Chọn chuyến đi" }),
  },
  {
    name: "public invitation",
    path: "/",
    setup: async (page) => page.getByRole("button", { name: "Rủ bạn đi cùng", exact: true }).click(),
    ready: (page) => page.getByRole("dialog", { name: /Rủ bạn đi/ }),
  },
  {
    name: "member trip requests",
    path: "/requests",
    ready: (page) => page.getByRole("heading", { level: 1, name: "Yêu cầu chuyến đi" }),
  },
  {
    name: "admin trips",
    path: "/admin/trips",
    ready: (page) => page.getByRole("heading", { level: 1, name: "Quản lý lịch" }),
  },
  {
    name: "admin trip requests",
    path: "/admin/requests",
    ready: (page) => page.getByRole("heading", { level: 1, name: "Yêu cầu chuyến đi" }),
  },
  {
    name: "admin invitations",
    path: "/admin/invitations",
    ready: (page) => page.getByRole("heading", { level: 2, name: "Quyền gửi lời rủ" }),
  },
  {
    name: "admin invitation history",
    path: "/admin/invitations?view=history",
    ready: (page) => page.getByRole("heading", { level: 2, name: "Lịch sử gửi" }),
  },
  {
    name: "admin users",
    path: "/admin/users",
    ready: (page) => page.getByRole("heading", { level: 2, name: "Hoạt động người dùng" }),
  },
  {
    name: "agentic assistant",
    path: "/v1",
    ready: (page) => page.getByRole("heading", { level: 2, name: "Hỏi, nghiên cứu, rồi quyết định" }),
  },
];

for (const viewport of viewports) {
  test(`${viewport.name} audits every public and admin surface`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const surface of surfaces) {
      await test.step(surface.name, async () => {
        await gotoHealthy(page, surface.path);
        await surface.setup?.(page);
        await expect(surface.ready(page)).toBeVisible();
        await page.waitForTimeout(250);
        await page.screenshot({ path: testInfo.outputPath(`${surface.name.replaceAll(" ", "-")}.png`), fullPage: true });

        const audit = await page.evaluate(({ touch }) => {
          const visible = (element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const rendered = typeof element.checkVisibility !== "function" || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
            return rendered && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          };
          const controls = [...document.querySelectorAll("button, select, input, textarea")].filter(visible);
          const clippedText = [...document.querySelectorAll("h1, h2, h3, h4, button, select")]
            .filter(visible)
            .filter((element) => element.scrollWidth > element.clientWidth + 1)
            .map((element) => (element.getAttribute("aria-label") || element.textContent || element.tagName).trim().slice(0, 60));
          const clippedControls = controls
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.left < -1 || rect.right > window.innerWidth + 1;
            })
            .map((element) => (element.getAttribute("aria-label") || element.textContent || element.tagName).trim().slice(0, 60));
          const smallTargets = touch ? controls
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                label: (element.getAttribute("aria-label") || element.textContent || element.tagName).trim().slice(0, 60),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              };
            })
            .filter((target) => target.width < 44 || target.height < 44) : [];
          return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            clipped: [...clippedText, ...clippedControls],
            smallTargets,
          };
        }, { touch: viewport.touch });

        expect(audit.documentWidth, `${surface.name} must not scroll horizontally`).toBe(audit.viewportWidth);
        expect(audit.clipped, `${surface.name} headings and controls must not clip`).toEqual([]);
        expect(audit.smallTargets, `${surface.name} mobile controls must be at least 44px`).toEqual([]);
      });
    }
  });
}
