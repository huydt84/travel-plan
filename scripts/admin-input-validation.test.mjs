import assert from "node:assert/strict";
import test from "node:test";
import { parseScheduleInput, parseSourceInput } from "../lib/validation.js";

test("new schedule activities accept an empty optional detail", () => {
  const input = parseScheduleInput({
    startDate: "2030-01-01",
    start: "09:00",
    endDate: "2030-01-01",
    end: "10:00",
    displayEnd: null,
    type: "Picnic",
    icon: "🧺",
    title: "Picnic trong công viên",
    detail: "",
    refs: [],
    branchId: null,
  });
  assert.equal(input.detail, "");
});

test("source updates accept partial title or URL changes", () => {
  assert.deepEqual(parseSourceInput({ title: "Nguồn chính thức" }, { partial: true }), { title: "Nguồn chính thức" });
  assert.deepEqual(parseSourceInput({ url: "https://www.example.com/place" }, { partial: true }), {
    title: undefined,
    host: "example.com",
    url: "https://www.example.com/place",
  });
  assert.throws(() => parseSourceInput({}, { partial: true }), /At least one source field is required/);
});
