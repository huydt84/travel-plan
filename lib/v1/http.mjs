import { NextResponse } from "next/server";
import { getViewer } from "../auth.js";
import { resolveAgenticV1Config } from "./config.mjs";
import { AssistantFault, assistantFault } from "./errors.mjs";
import { validateSchema } from "./schemas.mjs";

export function assertV1Enabled() {
  if (!resolveAgenticV1Config().enabled) {
    throw new AssistantFault("V1_NOT_FOUND", "Not found", { status: 404 });
  }
}

export async function requireV1Actor() {
  assertV1Enabled();
  const viewer = await getViewer();
  if (!viewer) throw new AssistantFault("UNAUTHENTICATED", "Bạn cần đăng nhập bằng Google", { status: 401 });
  if (!viewer.isAdmin) throw new AssistantFault("PILOT_FORBIDDEN", "Bản thử nghiệm chỉ dành cho owner và admin", { status: 403 });
  return viewer;
}

export async function readValidatedJson(request, schema) {
  let body;
  try { body = await request.json(); }
  catch { throw new AssistantFault("INVALID_INPUT", "Request body phải là JSON hợp lệ", { status: 400 }); }
  return validateSchema(schema, body);
}

export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_URL ? new URL(process.env.APP_URL).origin : new URL(request.url).origin;
  if (!origin || origin !== expected) throw new AssistantFault("ORIGIN_FORBIDDEN", "Nguồn yêu cầu không hợp lệ", { status: 403 });
}

export function assistantErrorResponse(error) {
  const fault = assistantFault(error);
  return NextResponse.json({ error: fault.message, code: fault.code, retryable: fault.retryable, details: fault.details }, { status: fault.status });
}

export function ndjsonResponse(events, cancel = () => {}) {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  let cancelled = false;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (cancelled) return;
        if (done) controller.close();
        else controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch {
        if (!cancelled) controller.error(new Error("Assistant stream interrupted"));
        cancel();
      }
    },
    cancel() { cancelled = true; cancel(); },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-content-type-options": "nosniff",
      "x-accel-buffering": "no",
    },
  });
}
