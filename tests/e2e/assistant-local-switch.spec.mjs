import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

// Explicit local acceptance: retains both trips and conversations for inspection.
test.skip(process.env.E2E_LOCAL_TRIP_SWITCH !== "true", "Opt in against the running local preview with the Kyoto example imported");

for (const [name, width, height] of [["phone", 320, 760], ["macbook", 1440, 900], ["dell", 1920, 1080]]) {
  test(`local ${name}: independent workers, Stop isolation, background completion and reload`, async ({ page }, testInfo) => {
    const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
    const evidence = [];
    const record = async (label, ids) => {
      const rows = await sql`SELECT t.id,t.status,t.error_code,t.output_text,t.mentions,j.workflow_id,j.claimed_at
        FROM assistant_turns t JOIN assistant_conversations c ON c.id=t.conversation_id
        JOIN assistant_jobs j ON j.turn_id=t.id WHERE t.id=ANY(${ids}::uuid[]) ORDER BY t.id`;
      evidence.push({ label, at: new Date().toISOString(), rows });
      return rows;
    };
    try {
      const trips = await sql`SELECT id,slug,title FROM trips ORDER BY created_at`;
      const b = trips.find((trip) => trip.slug === "kyoto-local-assistant");
      const a = trips.find((trip) => trip.id !== b?.id);
      expect(a).toBeTruthy(); expect(b).toBeTruthy();
      const before = await sql`SELECT * FROM activities WHERE trip_id=ANY(${[a.id,b.id]}::bigint[]) ORDER BY id`;
      // Refresh this process's trip list after the separate local importer.
      expect((await page.request.patch(`/api/trips/${b.slug}`, { data: { title: b.title } })).ok()).toBe(true);
      await page.setViewportSize({ width, height });
      await gotoHealthy(page, `/?trip=${a.slug}`);
      await page.getByRole("button", { name: "Trợ lý", exact: true }).click();
      const input = page.getByRole("textbox", { name: "Yêu cầu cho trợ lý" });
      await expect(input).toBeEnabled();
      // Both submissions go through the normal acceptance + Workflow dispatch API.
      // No seeded turns, manual worker claims, fabricated deltas, or publication calls.
      const submit = async (trip) => {
        const response = await page.request.post(`/api/v1/trips/${trip.slug}/assistant/turns`, {
          headers: { origin: new URL(page.url()).origin },
          data: { clientTurnId: randomUUID(), message: `Tóm tắt lịch ${trip.title}; chỉ trả lời, không thay đổi lịch.` },
        });
        expect(response.status()).toBe(202);
        return response.json();
      };
      const [runA, runB] = await Promise.all([submit(a), submit(b)]);
      expect(runA.conversationId).not.toBe(runB.conversationId);
      const ids = [runA.runId, runB.runId];
      expect((await record("both accepted", ids)).map((row) => row.status)).toEqual(["running", "running"]);
      await page.goto(`/assistant?trip=${b.slug}&conversation=${runB.conversationId}`);
      await expect(page.getByRole("button", { name: "Dừng", exact: true })).toBeVisible();
      await input.fill(`Bản nháp ${b.title}`);
      const overlapping = await record("viewing Kyoto while both workers run", ids);
      expect(overlapping.every((row) => row.status === "running")).toBe(true);
      expect(overlapping.every((row) => row.claimed_at && row.workflow_id)).toBe(true);
      expect(new Set(overlapping.map((row) => row.workflow_id)).size).toBe(2);
      await page.getByRole("button", { name: "Dừng", exact: true }).click();
      await expect(page.getByText(/Đã dừng trả lời/)).toBeVisible();
      const stopped = (await record("Kyoto stopped", ids)).find((row) => row.id === runB.runId);
      expect(stopped.status).toBe("failed");
      expect(stopped.error_code).toBe("TURN_CANCELLED");
      await expect.poll(async () => (await sql`SELECT status FROM assistant_turns WHERE id=${runA.runId}`)[0].status).toBe("completed");
      const completed = await record("other trip completed without its viewer", ids);
      const completedA = completed.find((row) => row.id === runA.runId);
      expect(completedA.mentions).toContainEqual({ kind: "trip", id: String(a.id) });
      expect(completedA.output_text).toContain(a.title);
      expect(completedA.workflow_id).toBeTruthy();
      expect(completed.find((row) => row.id === runB.runId).output_text).toBe(stopped.output_text);
      expect(await sql`SELECT id FROM assistant_change_sets WHERE turn_id=ANY(${ids}::uuid[])`).toHaveLength(0);
      await page.goto(`/assistant?trip=${a.slug}&conversation=${runA.conversationId}`);
      await expect(page.getByText(completedA.output_text.split("\n\n")[0], { exact: false })).toBeVisible();
      await input.fill(`Bản nháp ${a.title}`);
      await page.reload();
      await expect(input).toHaveValue(`Bản nháp ${a.title}`);
      await page.goto(`/assistant?trip=${b.slug}&conversation=${runB.conversationId}`);
      await expect(input).toHaveValue(`Bản nháp ${b.title}`);
      await expect(page.getByText(/Đã dừng trả lời/)).toBeVisible();
      expect(await sql`SELECT * FROM activities WHERE trip_id=ANY(${[a.id,b.id]}::bigint[]) ORDER BY id`).toEqual(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await mkdir(".impeccable/review/trip-switch", { recursive: true });
      await page.screenshot({ path: `.impeccable/review/trip-switch/${name}.png`, fullPage: true });
      await writeFile(`.impeccable/review/trip-switch/${name}-execution.json`, JSON.stringify(evidence, null, 2));
    } finally {
      await testInfo.attach("execution-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
      await sql.end();
    }
  });
}
