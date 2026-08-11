import assert from "node:assert/strict";
import test from "node:test";
import { sourceDetailsFromUrl } from "../lib/source-fields.mjs";

test("source URLs preserve the submitted URL and infer a compact host", () => {
  assert.deepEqual(sourceDetailsFromUrl(" https://www.example.com/place?id=42 "), {
    url: "https://www.example.com/place?id=42",
    host: "example.com",
  });
});

test("source URLs only accept HTTP and HTTPS links", () => {
  assert.equal(sourceDetailsFromUrl("javascript:alert(1)"), null);
  assert.equal(sourceDetailsFromUrl("not a URL"), null);
  assert.equal(sourceDetailsFromUrl(""), null);
});
