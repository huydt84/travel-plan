import { expect, gotoHealthy, test } from "./fixtures.mjs";
import { anonymousHeaders } from "./permission-fixture.mjs";

const viewports = [
  { name: "phone", width: 320, height: 760, touch: true },
  { name: "macbook", width: 1440, height: 900, touch: false },
  { name: "dell", width: 1920, height: 1080, touch: false },
];
const authViewports = [
  viewports[0],
  { name: "small phone", width: 390, height: 844 },
  { name: "compact desktop", width: 1024, height: 768 },
  viewports[1],
  viewports[2],
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
    name: "admin source editor",
    path: "/admin/trips",
    setup: async (page) => page.getByRole("button", { name: "Thêm nguồn tham khảo", exact: true }).click(),
    ready: (page) => page.locator(".source-form").getByLabel("Tên nguồn"),
  },
  {
    name: "admin route editor",
    path: "/admin/trips",
    setup: async (page) => page.getByRole("button", { name: "Thêm tuyến đường", exact: true }).click(),
    ready: (page) => page.locator(".route-form").getByLabel("Điểm bắt đầu"),
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

for (const viewport of authViewports) {
  test(`${viewport.name} keeps signed-out copy beside the grouped auth panel`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      extraHTTPHeaders: anonymousHeaders,
    });
    try {
      const page = await context.newPage();
      await gotoHealthy(page, "/");
      const heading = page.getByRole("heading", { level: 1, name: "Lịch trình riêng của nhóm bạn" });
      const panel = page.getByRole("complementary", { name: "Chỉ thành viên mới có quyền truy cập" });
      const intro = page.getByText("Đăng nhập để mở những chuyến đi mà bạn đang tham gia.");
      const privacy = panel.getByText("Tên chuyến, lịch trình và thành viên không hiển thị công khai.");
      const button = panel.getByRole("button", { name: "Tiếp tục với Google" });
      await expect(heading).toBeVisible();
      await expect(intro).toBeVisible();
      await expect(privacy).toBeVisible();
      await expect(button).toBeVisible();
      const boxes = await Promise.all([heading, intro, panel, privacy, button].map((locator) => locator.boundingBox()));
      const [headingBox, introBox, panelBox, privacyBox, buttonBox] = boxes;
      const layout = await heading.evaluate((element) => {
        const row = element.parentElement.parentElement;
        const hero = row.parentElement;
        const line = hero.lastElementChild;
        const box = (node) => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
        };
        const text = element.firstChild;
        const lines = new Map();
        for (const word of text.textContent.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(text, word.index);
          range.setEnd(text, word.index + word[0].length);
          const top = Math.round(range.getBoundingClientRect().top);
          lines.set(top, [...(lines.get(top) || []), word[0]]);
        }
        return {
          row: box(row), hero: box(hero), line: box(line),
          headingLines: [...lines.values()].map((words) => words.join(" ").toLocaleUpperCase("vi-VN")),
          fontSize: parseFloat(getComputedStyle(element).fontSize),
          lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        };
      });
      expect(Math.abs(layout.line.x - layout.row.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(layout.line.right - layout.row.right)).toBeLessThanOrEqual(1);
      expect(layout.line.y - layout.row.bottom).toBeGreaterThanOrEqual(40);
      expect(layout.line.y - layout.row.bottom).toBeLessThanOrEqual(56);
      expect(layout.lineHeight).toBeGreaterThanOrEqual(layout.fontSize);
      if (viewport.width >= 1024) {
        expect(layout.headingLines).toEqual(["LỊCH TRÌNH RIÊNG", "CỦA NHÓM BẠN"]);
        expect(panelBox.x).toBeGreaterThanOrEqual(headingBox.x + headingBox.width - 1);
        expect(Math.abs(panelBox.y + panelBox.height / 2 - (layout.row.y + layout.row.height / 2))).toBeLessThanOrEqual(1);
        expect(Math.abs(headingBox.y + (introBox.y + introBox.height - headingBox.y) / 2 - (panelBox.y + panelBox.height / 2))).toBeLessThanOrEqual(1);
        expect(introBox.y - (headingBox.y + headingBox.height)).toBeGreaterThanOrEqual(24);
        expect(introBox.y - (headingBox.y + headingBox.height)).toBeLessThanOrEqual(32);
        expect(layout.hero.height).toBeLessThan(550);
        if (viewport.width >= 1440) {
          expect(panelBox.x - layout.row.x - headingBox.width).toBeGreaterThanOrEqual(64);
          expect(panelBox.x - layout.row.x - headingBox.width).toBeLessThanOrEqual(96);
        }
      } else {
        expect(panelBox.y).toBeGreaterThanOrEqual(introBox.y + introBox.height - 1);
      }
      for (const box of [privacyBox, buttonBox]) {
        expect(box.x).toBeGreaterThanOrEqual(panelBox.x);
        expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
        expect(box.y + box.height).toBeLessThanOrEqual(panelBox.y + panelBox.height);
      }
      expect(await panel.evaluate((element) => getComputedStyle(element).writingMode)).toBe("horizontal-tb");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      await page.screenshot({ path: testInfo.outputPath("signed-out-auth.png"), fullPage: false });
    } finally {
      await context.close();
    }
  });
}

for (const viewport of viewports) {
  test(`${viewport.name} audits every public and admin surface`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const surface of surfaces) {
      await test.step(surface.name, async () => {
        await gotoHealthy(page, surface.path);
        await surface.setup?.(page);
        await expect(surface.ready(page)).toBeVisible();
        if (["admin source editor", "admin route editor"].includes(surface.name)) await surface.ready(page).scrollIntoViewIfNeeded();
        if (surface.name === "assistant management") {
          await expect(page.getByRole("button", { name: "Trợ lý", exact: true })).toHaveCount(0);
        }
        if (surface.name === "public tracker") {
          const tripControls = await page.evaluate(() => {
            const context = document.querySelector(".trip-context");
            const picker = context.querySelector(".trip-picker");
            const select = picker.querySelector('[role="combobox"]');
            const actions = context.querySelector(".trip-context-actions");
            const clock = context.querySelector(".live-clock");
            const metadata = context.querySelector('[class*="trip-metadata"]');
            const header = document.querySelector(".trip-bar");
            const appActions = header.querySelector("nav");
            const contextBox = context.getBoundingClientRect();
            const pickerBox = picker.getBoundingClientRect();
            const selectBox = select.getBoundingClientRect();
            const actionsBox = actions.getBoundingClientRect();
            const clockBox = clock.getBoundingClientRect();
            const metadataBox = metadata.getBoundingClientRect();
            const style = getComputedStyle(select);
            const canvas = document.createElement("canvas");
            const measure = canvas.getContext("2d");
            measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const selectedText = select.querySelector('[class*="trip-picker-title"]')?.textContent || "";
            return {
              contextWidth: contextBox.width,
              pickerWidth: pickerBox.width,
              selectWidth: selectBox.width,
              selectedTextWidth: measure.measureText(selectedText).width,
              actionsTop: actionsBox.top,
              pickerBottom: pickerBox.bottom,
              pickerTop: pickerBox.top,
              actionsBottom: actionsBox.bottom,
              pickerRight: pickerBox.right,
              actionsLeft: actionsBox.left,
              actionsRight: actionsBox.right,
              clockLeft: clockBox.left,
              clockRight: clockBox.right,
              metadataTop: metadataBox.top,
              gap: parseFloat(getComputedStyle(context).columnGap),
              contentRight: contextBox.right - parseFloat(getComputedStyle(context).paddingRight),
              appActionsInHeader: Boolean(appActions?.querySelector("a")),
              tripActionsCount: actions.querySelectorAll("a, button").length,
              shareInContext: [...actions.querySelectorAll("button")].some((button) => button.textContent.trim() === "Chia sẻ"),
              shareInHeader: [...header.querySelectorAll("button")].some((button) => button.textContent.trim() === "Chia sẻ"),
            };
          });
          expect(tripControls.selectWidth).toBeGreaterThanOrEqual(tripControls.pickerWidth - 2);
          if (viewport.touch) expect(tripControls.actionsTop).toBeGreaterThanOrEqual(tripControls.pickerBottom - 1);
          else {
            expect(tripControls.actionsTop).toBeLessThan(tripControls.pickerBottom);
            expect(Math.abs(tripControls.actionsLeft - tripControls.pickerRight - tripControls.gap)).toBeLessThanOrEqual(2);
            expect(Math.abs(tripControls.clockLeft - tripControls.actionsRight - tripControls.gap)).toBeLessThanOrEqual(2);
            expect(Math.abs(tripControls.clockRight - tripControls.contentRight)).toBeLessThanOrEqual(2);
            expect(tripControls.metadataTop).toBeGreaterThanOrEqual(tripControls.pickerBottom - 1);
          }
          expect(tripControls.appActionsInHeader).toBe(true);
          expect(tripControls.tripActionsCount).toBe(3);
          expect(tripControls.shareInContext).toBe(true);
          expect(tripControls.shareInHeader).toBe(false);
          if (!viewport.touch) expect(tripControls.selectWidth).toBeGreaterThan(tripControls.selectedTextWidth + 35);
        }
        if (surface.name === "public invitation") {
          const dialog = page.getByRole("dialog", { name: /Rủ bạn đi/ });
          await expect(dialog.getByRole("combobox", { name: "Ngôn ngữ" })).toHaveCount(0);
          const dialogGeometry = await dialog.evaluate((element) => {
            const dialogBox = element.getBoundingClientRect();
            const closeBox = element.querySelector('button[aria-label="Đóng lời rủ"]')?.getBoundingClientRect();
            return closeBox
              ? {
                  dialogRight: dialogBox.right,
                  dialogTop: dialogBox.top,
                  closeRight: closeBox.right,
                  closeTop: closeBox.top,
                  closeHeight: closeBox.height,
                }
              : null;
          });
          expect(dialogGeometry).not.toBeNull();
          expect(dialogGeometry.closeRight).toBeGreaterThanOrEqual(dialogGeometry.dialogRight - 76);
          expect(dialogGeometry.closeTop).toBeLessThanOrEqual(dialogGeometry.dialogTop + 96);
          expect(dialogGeometry.closeHeight).toBeGreaterThanOrEqual(44);
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
        if (surface.name === "admin trips") {
          const memberDelete = page.getByRole("button", { name: "Xóa", exact: true });
          await expect(memberDelete).toBeVisible();
          const memberLayout = await memberDelete.evaluate((button) => {
            const row = button.closest("li");
            const actions = button.closest('[class*="member-actions"]');
            const permission = row?.querySelector('[class*="member-expense-permission"]');
            if (!row || !actions || !permission) return null;
            const rowRect = row.getBoundingClientRect();
            const actionRect = actions.getBoundingClientRect();
            const permissionRect = permission.getBoundingClientRect();
            return {
              row: { left: rowRect.left, right: rowRect.right, bottom: rowRect.bottom },
              actions: { left: actionRect.left, right: actionRect.right, top: actionRect.top, bottom: actionRect.bottom },
              permission: { right: permissionRect.right, bottom: permissionRect.bottom },
            };
          });
          expect(memberLayout, "member controls must share one member row").not.toBeNull();
          expect(memberLayout.actions.left).toBeGreaterThanOrEqual(memberLayout.row.left);
          expect(memberLayout.actions.right).toBeLessThanOrEqual(memberLayout.row.right + 1);
          expect(memberLayout.actions.bottom).toBeLessThanOrEqual(memberLayout.row.bottom + 1);
          if (viewport.touch) {
            expect(memberLayout.actions.top).toBeGreaterThanOrEqual(memberLayout.permission.bottom - 1);
          } else {
            expect(memberLayout.actions.left).toBeGreaterThanOrEqual(memberLayout.permission.right - 1);
          }
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
