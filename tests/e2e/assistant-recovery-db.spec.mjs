import { randomUUID } from "node:crypto";
import { createPostgresSql } from "../../lib/sql-adapter.mjs";
import { DEFAULT_LOCAL_POSTGRES_URI } from "../../lib/runtime-config.mjs";
import { createAssistantStore } from "../../lib/v1/store.mjs";
import { commitStoredChangeSet } from "../../lib/v1/committer.mjs";
import { expect, test } from "./fixtures.mjs";

async function fixture() {
  const sql = createPostgresSql(DEFAULT_LOCAL_POSTGRES_URI);
  const slug = `harness-${randomUUID()}`, ownerEmail = `${randomUUID()}@example.com`;
  const [trip] = await sql`INSERT INTO trips(slug,title,trip_date,end_date,timezone,location)
    VALUES(${slug},'Harness','2030-01-01','2030-01-01','Asia/Tokyo','Tokyo') RETURNING *`;
  trip.plan_revision = (await sql`SELECT plan_revision FROM trips WHERE id=${trip.id}`)[0].plan_revision;
  await sql`INSERT INTO users(email,name,role,first_login,last_login,last_active_at) VALUES(${ownerEmail},'Assistant fixture','admin',NOW(),NOW(),NOW()) ON CONFLICT(email) DO UPDATE SET role='admin'`;
  const store = createAssistantStore({ sql });
  const accept = (overrides = {}) => store.acceptRequest({ ownerEmail, tripSlug: slug, conversationId: null,
    clientTurnId: randomUUID(), input: "Hello", title: "Harness", leaseMs: 60000, maxTurnsPerHour: 100, ...overrides });
  return { sql, trip, store, accept, ownerEmail, cleanup: async () => { await sql`DELETE FROM assistant_conversations WHERE owner_email=${ownerEmail}`; await sql`DELETE FROM trips WHERE id=${trip.id}`; await sql`DELETE FROM users WHERE email=${ownerEmail}`; await sql.end(); } };
}

test("simultaneous first submissions create one conversation and one ledger entry", async () => {
  const f = await fixture();
  try {
    const clientTurnId = randomUUID();
    const [first, replay] = await Promise.all([f.accept({ clientTurnId }), f.accept({ clientTurnId })]);
    expect(first.turn.id).toBe(replay.turn.id);
    expect(first.conversation.id).toBe(replay.conversation.id);
    expect(await f.sql`SELECT * FROM assistant_conversations WHERE owner_email=${f.ownerEmail}`).toHaveLength(1);
    expect(await f.sql`SELECT * FROM assistant_requests WHERE owner_email=${f.ownerEmail}`).toHaveLength(1);
    await expect(f.accept({ clientTurnId, input: "Different" })).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect(await f.store.findRequest("outsider@example.com", clientTurnId)).toBeNull();
  } finally { await f.cleanup(); }
});

test("actor quota is atomic across simultaneous conversations", async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([f.accept({ maxTurnsPerHour: 1 }), f.accept({ maxTurnsPerHour: 1 })]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.find((item) => item.status === "rejected").reason.code).toBe("TURN_RATE_LIMIT");
    expect(await f.sql`SELECT * FROM assistant_conversations WHERE owner_email=${f.ownerEmail}`).toHaveLength(1);
  } finally { await f.cleanup(); }
});

test("expired replay reconciles tools and refuses late publication", async () => {
  const f = await fixture();
  try {
    const clientTurnId = randomUUID(), first = await f.accept({ clientTurnId });
    const tool = await f.store.createToolRun({ turnId: first.turn.id, toolName: "search_web" });
    await f.sql`UPDATE assistant_turns SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=${first.turn.id}`;
    const replay = await f.accept({ clientTurnId });
    expect(replay.turn.status).toBe("failed");
    expect(replay.turn.errorCode).toBe("TURN_INTERRUPTED");
    await expect(f.store.publishTurn({ turnId: first.turn.id, output: "Late", citations: [] })).rejects.toMatchObject({ code: "TURN_INTERRUPTED" });
    await f.store.finishToolRun(tool, { status: "completed" });
    expect((await f.sql`SELECT status FROM assistant_tool_runs WHERE id=${tool}`)[0].status).toBe("failed");
  } finally { await f.cleanup(); }
});

test("proposal publication rolls back its answer and concurrent confirms replay a receipt", async () => {
  const f = await fixture();
  try {
    const first = await f.accept();
    const proposal = { id: randomUUID(), tripId: String(f.trip.id), operations: [{ kind: "source.add", sourceNumber: 1, title: "Official", host: "example.com", url: "https://example.com" }],
      preview: { summary: "Add source", changes: [] }, baseRevision: Number(f.trip.plan_revision), digest: "digest", tokenHash: "hash", expiresAt: new Date(Date.now() + 60000).toISOString() };
    await expect(f.store.publishTurn({ turnId: first.turn.id, output: "Answer", citations: [], proposal: { ...proposal, id: "bad-uuid" } })).rejects.toBeTruthy();
    expect((await f.sql`SELECT status,output_text FROM assistant_turns WHERE id=${first.turn.id}`)[0]).toEqual({ status: "running", output_text: null });
    const completed = await f.store.publishTurn({ turnId: first.turn.id, output: "Answer", citations: [], proposal });
    expect(completed.changeSet.status).toBe("staged");
    expect(await f.sql`SELECT * FROM sources WHERE trip_id=${f.trip.id}`).toHaveLength(0);
    const input = { store: f.store, changeSet: completed.changeSet, actorEmail: f.ownerEmail };
    const receipts = await Promise.all([commitStoredChangeSet(input), commitStoredChangeSet(input)]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(await f.sql`SELECT * FROM sources WHERE trip_id=${f.trip.id}`).toHaveLength(1);
  } finally { await f.cleanup(); }
});

test("history selects the newest completed turns and pages backwards without duplicates", async () => {
  const f = await fixture();
  try {
    const first = await f.accept();
    await f.store.failTurn(first.turn.id, "TEST");
    for (let i = 0; i < 65; i++) {
      await f.sql`INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,output_text,status,created_at)
        VALUES(${randomUUID()},${first.conversation.id},${randomUUID()},${String(i)},'Answer','completed',NOW()-INTERVAL '2 days'+${i}*INTERVAL '1 second')`;
    }
    const latest = await f.store.listTurns(first.conversation.id, f.ownerEmail, { limit: 12, completedOnly: true });
    expect(latest.map((turn) => turn.input)).toEqual(Array.from({ length: 12 }, (_, i) => String(53 + i)));
    const previous = await f.store.listTurns(first.conversation.id, f.ownerEmail, { limit: 12, completedOnly: true, before: { id: latest[0].id, createdAt: latest[0].createdAt } });
    expect(previous.at(-1).input).toBe("52");
    await expect(f.store.listTurns(first.conversation.id, "outsider@example.com")).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  } finally { await f.cleanup(); }
});

test("legacy orphan proposals cannot write even with a matching revision", async () => {
  const f = await fixture();
  try {
    const first = await f.accept();
    const proposal = await f.store.stageChangeSet({ turnId: first.turn.id, tripSlug: f.trip.slug,
      operations: [{ kind: "source.add", sourceNumber: 1, title: "No", host: "example.com", url: "https://example.com" }],
      preview: { summary: "No" }, citations: [], baseRevision: Number(f.trip.plan_revision), digest: "d", tokenHash: "t", expiresAt: new Date(Date.now()+60000) });
    await expect(commitStoredChangeSet({ store: f.store, changeSet: proposal, actorEmail: f.ownerEmail })).rejects.toMatchObject({ code: "PROPOSAL_INCOMPLETE" });
    expect(await f.sql`SELECT * FROM sources WHERE trip_id=${f.trip.id}`).toHaveLength(0);
  } finally { await f.cleanup(); }
});


test("history cursors preserve microseconds and request lookup includes an old proposal", async () => {
  const f = await fixture();
  try {
    const first = await f.accept();
    const proposal = { id: randomUUID(), tripId: String(f.trip.id), operations: [], preview: { changes: [], summary: "Old" },
      baseRevision: Number(f.trip.plan_revision), digest: "digest", tokenHash: "hash", expiresAt: new Date(Date.now()+60000).toISOString() };
    await f.store.publishTurn({ turnId: first.turn.id, output: "Old", citations: [], proposal });
    for (let i = 0; i < 3; i++) await f.sql`INSERT INTO assistant_turns(id,conversation_id,client_turn_id,input_text,status,created_at)
      VALUES(${randomUUID()},${first.conversation.id},${randomUUID()},${String(i)},'completed','2035-01-01T00:00:00.123000Z'::TIMESTAMPTZ+${i}*INTERVAL '1 microsecond')`;
    const [latest] = await f.store.listTurns(first.conversation.id, f.ownerEmail, { limit: 1 });
    expect(latest.input).toBe("2");
    const [previous] = await f.store.listTurns(first.conversation.id, f.ownerEmail, { limit: 1, before: { id: latest.id, createdAt: latest.createdAt } });
    expect(previous.input).toBe("1");
    const lookup = await f.store.findRequest(f.ownerEmail, first.turn.clientTurnId);
    expect(lookup.changeSet.id).toBe(proposal.id);
  } finally { await f.cleanup(); }
});
