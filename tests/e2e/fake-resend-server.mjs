import { createHash } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 3101;
const expectedApiKey = process.env.FAKE_RESEND_API_KEY || "e2e-test-key";
const maxBodyBytes = 1_000_000;

const writeJson = (response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

const readBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
  if (request.method === "GET" && requestUrl.pathname === "/health") {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method !== "POST" || requestUrl.pathname !== "/emails") {
    writeJson(response, 404, { error: "NOT_FOUND" });
    return;
  }

  if (request.headers.authorization !== `Bearer ${expectedApiKey}`) {
    writeJson(response, 401, { error: "UNAUTHORIZED" });
    return;
  }
  if (!request.headers["content-type"]?.includes("application/json")) {
    writeJson(response, 415, { error: "CONTENT_TYPE_REQUIRED" });
    return;
  }

  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || !idempotencyKey.startsWith("admin-contribution/")) {
    writeJson(response, 400, { error: "IDEMPOTENCY_KEY_REQUIRED" });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch (error) {
    writeJson(response, 400, { error: error.message === "BODY_TOO_LARGE" ? error.message : "INVALID_JSON" });
    return;
  }

  if (
    typeof payload?.from !== "string"
    || !Array.isArray(payload?.to)
    || payload.to.length === 0
    || typeof payload?.subject !== "string"
    || typeof payload?.text !== "string"
    || typeof payload?.html !== "string"
  ) {
    writeJson(response, 422, { error: "INVALID_EMAIL_PAYLOAD" });
    return;
  }

  const digest = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16);
  writeJson(response, 200, { id: `fake-resend-${digest}` });
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.listen(port, host);
