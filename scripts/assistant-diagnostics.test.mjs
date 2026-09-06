import test from "node:test";
import assert from "node:assert/strict";
import { failureDiagnostic } from "../lib/v1/failure-diagnostics.mjs";
test("diagnostics retain operational evidence without copying provider payloads", () => {
  const error = Object.assign(new Error("SECRET prompt and credential"), {
    status: 429, headers: { authorization: "SECRET" }, body: "SECRET", name: "SECRET",
    cause: Object.assign(new Error("SECRET"), { code: "ECONNRESET" }),
  });
  const diagnostic = failureDiagnostic(error, "model");
  assert.equal(diagnostic.upstreamStatus, 429);
  assert.equal(diagnostic.cause.systemCode, "ECONNRESET");
  assert.equal(JSON.stringify(diagnostic).includes("SECRET"), false);
  error.cause = error;
  assert.doesNotThrow(() => JSON.stringify(failureDiagnostic(error, "model")));
});
