import { expect, gotoHealthy, test } from "./fixtures.mjs";

const viewports = [
  { name: "phone", width: 320, height: 760, touch: true },
  { name: "macbook", width: 1440, height: 900, touch: false },
  { name: "dell", width: 1920, height: 1080, touch: false },
];

const surfaces = [
  { name: "assistant management", path: "/admin/assistant", ready: (page) => page.getByRole("heading", { level: 1, name: "Quản lý trợ lý" }) },
  { name: "trip companion", path: "/?chat=1", ready: (page) => page.getByRole("heading", { level: 1, name: "Trợ lý hành trình" }) },
  { name: "assistant history", path: "/assistant", setup: async (page) => page.getByRole("button", { name: "Lịch sử", exact: true }).click(), ready: (page) => page.getByRole("navigation", { name: "Lịch sử trò chuyện" }) },
  {
    name: "public tracker",
    path: "/",
    ready: (page) => page.getByRole("combobox", { name: "Chọn chuyến đi" }),
  },
  {
    name: "public schedule editor",
    path: "/",
    setup: async (page) => page.getByRole("button", { name: /Thêm vào ngày này|Thêm hoạt động/ }).first().click(),
    ready: (page) => page.locator("#schedule-editor-new"),
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
    name: "admin collections",
    path: "/admin/collections",
    ready: (page) => page.getByRole("heading", { level: 1, name: "Bộ sưu tập địa điểm" }),
  },
  {
    name: "admin collection preview",
    path: "/admin/collections",
    setup: async (page) => {
      await page.route("**/api/admin/place-collections/sync-previews", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
        id: "11111111-1111-4111-8111-111111111111", collectionId: null, title: "Tokyo field notes", description: "Preview fixture",
        publicUrl: "https://www.google.com/maps/placelists/list/test", parserVersion: "fixture-v1", digest: "a".repeat(64), expiresAt: "2030-01-01T00:00:00.000Z",
        summary: { added: 1, updated: 0, restored: 0, removed: 0, unchanged: 0 }, nextCursor: null,
        items: [{ position: 0, name: "Kiyosumi Garden", address: "Tokyo", note: "Quiet morning stop", mapsUrl: "https://www.google.com/maps", externalIds: [{ kind: "feature_tuple", value: "8:8" }], change: "added" }],
      }) }));
      await page.getByLabel("Liên kết danh sách Google Maps").fill("https://maps.app.goo.gl/example");
      await page.getByRole("button", { name: "Kiểm tra danh sách" }).click();
    },
    ready: (page) => page.getByText("Chưa có thay đổi nào được lưu.", { exact: false }),
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
    path: "/assistant",
    ready: (page) => page.getByRole("heading", { level: 1, name: "Trợ lý hành trình" }),
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
        if (surface.name === "assistant management") {
          await expect(page.getByRole("button", { name: "Trợ lý", exact: true })).toHaveCount(0);
        }
        if (surface.name === "public tracker" && viewport.touch) {
          await expect(page.locator(".desktop-manage-link")).toBeHidden();
        }
        if (surface.name === "admin users" && viewport.touch) {
          const splitDates = await page.locator(".admin-users-table time").evaluateAll((times) => times.flatMap((time) => {
            const text = [...time.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
            if (!text) return [];
            return [...text.textContent.matchAll(/\S+/g)].filter((match) => {
              const range = document.createRange();
              range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
              return range.getClientRects().length > 1;
            }).map((match) => match[0]);
          }));
          expect(splitDates, "dates must not split their year across lines").toEqual([]);
        }
        if (["trip companion", "agentic assistant"].includes(surface.name)) {
          const shell = page.getByRole("region", { name: "Trợ lý hành trình", exact: true });
          const header = await shell.locator("header").first().boundingBox();
          if (viewport.width === 320) expect(header.height).toBeLessThanOrEqual(160);
          const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
          await expect(input).toBeEnabled();
          await input.fill("Kiểm tra bố cục " + "nội dung dài ".repeat(40));
          const field = await input.boundingBox();
          const send = await page.getByRole("button", { name: "Gửi yêu cầu", exact: true }).boundingBox();
          expect(field.y).toBeGreaterThanOrEqual(header.y + header.height);
          expect(send.y).toBeGreaterThanOrEqual(field.y + field.height);
          expect(send.y + send.height).toBeLessThanOrEqual(viewport.height);
          expect(field.x + field.width).toBeLessThanOrEqual(viewport.width);
          await input.fill("");
          await input.blur();
        }
        await page.waitForTimeout(250);
        await page.screenshot({ path: testInfo.outputPath(`${surface.name.replaceAll(" ", "-")}.png`), fullPage: false });

        const audit = await page.evaluate(({ touch }) => {
          const visible = (element) => {
            if (element.closest("[inert], [aria-hidden=\"true\"], .sr-only")) return false;
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
              // A deliberate horizontal scroller can contain offscreen controls.
              // Its viewport, and each control's width, must still fit the page.
              for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
                if (["auto", "scroll"].includes(style.overflowX) && parent.scrollWidth > parent.clientWidth
                  && box.left >= 0 && box.right <= innerWidth && rect.width <= parent.clientWidth) return false;
              }
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

        expect.soft(audit.documentWidth, `${surface.name} must not scroll horizontally`).toBe(audit.viewportWidth);
        expect.soft(audit.clipped, `${surface.name} headings and controls must not clip`).toEqual([]);
        expect.soft(audit.smallTargets, `${surface.name} mobile controls must be at least 44px`).toEqual([]);
      });
    }
  });
}
