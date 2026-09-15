import { expect, gotoHealthy, test } from "./fixtures.mjs";

test("running assistant transitions across model stage titles before the readable tool action", async ({ page }) => {
  const runId = "00000000-0000-4000-8000-000000000091";
  const conversationId = "00000000-0000-4000-8000-000000000092";
  const input = "Kiểm tra giờ mở cửa Ghibli Museum";
  const turn = { id: runId, input, output: "", citations: [], status: "running" };

  await page.route("**/api/v1/assistant/workspace?*", async (route) => {
    const response = await route.fetch();
    const workspace = await response.json();
    workspace.selectedConversation = { id: conversationId, title: input, updatedAt: new Date().toISOString(), status: "running" };
    workspace.conversations = [workspace.selectedConversation];
    workspace.turns = [turn];
    await route.fulfill({ response, json: workspace });
  });

  let eventRequest = 0;
  await page.route(`**/api/v1/assistant/runs/${runId}/events?*`, async (route) => {
    eventRequest++;
    if (eventRequest === 1) {
      await route.fulfill({ contentType: "application/x-ndjson", body: [
        { seq: 1, runId, type: "accepted", conversationId },
        { seq: 2, runId, type: "progress", phase: "model-stage", label: "Đang phân tích yêu cầu về Ghibli Museum" },
      ].map(JSON.stringify).join("\n") });
      return;
    }
    if (eventRequest === 2) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({
        seq: 3, runId, type: "progress", phase: "model-stage", label: "Đang so sánh các nguồn thông tin",
      }) });
      return;
    }
    if (eventRequest === 3) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({
        seq: 4, runId, type: "progress", phase: "searching-web", label: "assistantExtra.progress.searchWebQuery", values: { query: "giờ mở cửa Ghibli Museum" },
      }) });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({
      seq: 5, runId, type: "completed", turn: { ...turn, output: "Đã kiểm tra.", status: "completed" },
    }) });
  });

  await gotoHealthy(page, "/assistant");
  await expect(page.getByRole("status").filter({ hasText: "Đang phân tích yêu cầu về Ghibli Museum" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Đang so sánh các nguồn thông tin" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Đang tìm nguồn web về “giờ mở cửa Ghibli Museum”" })).toBeVisible();
});
