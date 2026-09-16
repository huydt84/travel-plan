import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { processAdminNotificationOutboxRecords } from "../../lib/admin-notification-outbox-store.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { expect, gotoHealthy, test } from "./fixtures.mjs";

const localHeaders = (email, name) => ({
  "x-local-viewer-email": email,
  "x-local-viewer-name": name,
});

test("concurrent outbox workers deliver one contribution email once", async ({ browser, baseURL }) => {
  const marker = Date.now();
  const contributorContext = await browser.newContext({
    baseURL,
    extraHTTPHeaders: localHeaders(`outbox-${marker}@localhost.invalid`, "Outbox Contributor"),
  });
  const ownerContext = await browser.newContext({ baseURL });
  const page = await contributorContext.newPage();
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  let suggestion;
  let slug;

  try {
    await gotoHealthy(page, "/");
    slug = `outbox-${marker}`;
    expect((await ownerContext.request.post("/api/trips", { data: {
      slug,
      title: "Outbox fixture",
      startDate: "2030-01-01",
      endDate: "2030-01-01",
      timezone: "Asia/Tokyo",
      location: "Tokyo",
      memberEmails: [`outbox-${marker}@localhost.invalid`],
    } })).status()).toBe(201);
    const response = await contributorContext.request.post(`/api/trips/${encodeURIComponent(slug)}/suggestions`, {
      data: { activityId: null, kind: "comment", body: `Outbox concurrency ${marker}` },
    });
    expect(response.status()).toBe(201);
    suggestion = await response.json();

    let outbox = null;
    await expect.poll(async () => {
      [outbox] = await sql`
        SELECT id, status, resend_message_id
        FROM admin_notification_outbox
        WHERE suggestion_id = ${suggestion.id}
      `;
      return outbox?.status;
    }, { timeout: 5_000 }).toBe("sent");
    expect(outbox.status).toBe("sent");
    expect(outbox.resend_message_id).toMatch(/^fake-resend-/);

    await sql`
      UPDATE admin_notification_outbox
      SET status = 'pending', attempt_count = 0, next_attempt_at = NOW(), lease_expires_at = NULL
      WHERE id = ${outbox.id}
    `;

    let sends = 0;
    const sendImpl = async () => {
      sends += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return `resend-${marker}`;
    };
    const dependencies = { sendImpl, logger: { error() {} } };
    const [firstWorker, secondWorker] = await Promise.all([
      processAdminNotificationOutboxRecords(sql, { outboxId: outbox.id }, dependencies),
      processAdminNotificationOutboxRecords(sql, { outboxId: outbox.id }, dependencies),
    ]);

    expect(sends).toBe(1);
    expect([...firstWorker, ...secondWorker]).toHaveLength(1);
    expect([...firstWorker, ...secondWorker][0]).toMatchObject({
      outboxId: String(outbox.id),
      status: "sent",
      resendMessageId: `resend-${marker}`,
    });
  } finally {
    if (slug) await ownerContext.request.delete(`/api/trips/${encodeURIComponent(slug)}`);
    await sql.end();
    await page.close();
    await contributorContext.close();
    await ownerContext.close();
  }
});
