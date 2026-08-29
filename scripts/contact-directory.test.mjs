import assert from "node:assert/strict";
import test from "node:test";
import { parseContactDirectory } from "../lib/contact-directory.mjs";

test("parses a compact phone directory into call and copy values", () => {
  assert.deepEqual(
    parseContactDirectory("Red Lobster — 03-3599-5521\nTGI FRIDAYS — 050-3196-3586"),
    [
      { name: "Red Lobster", phone: "03-3599-5521", dial: "0335995521" },
      { name: "TGI FRIDAYS", phone: "050-3196-3586", dial: "05031963586" },
    ],
  );
});

test("leaves ordinary activity details as prose", () => {
  assert.equal(parseContactDirectory("Nếu cả hai quán đều kín, thử walk-in sau drone."), null);
  assert.equal(parseContactDirectory("Red Lobster: 03-3599-5521"), null);
});
