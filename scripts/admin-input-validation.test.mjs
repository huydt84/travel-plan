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

test("reservation contact rows accept optional phone and link fields", () => {
  const input = parseScheduleInput({
    startDate: "2030-01-01", start: "09:00", endDate: "2030-01-01", end: "10:00",
    type: "Reservation", icon: "📞", title: "Book dinner", detail: "", refs: [],
    reservationContacts: [
      { name: "Restaurant", phone: "03-1234-5678", link: "https://example.com/book" },
      { name: "Hotel", phone: "", link: "" },
    ],
  });
  assert.deepEqual(input.reservationContacts, [
    { name: "Restaurant", phone: "03-1234-5678", link: "https://example.com/book" },
    { name: "Hotel", phone: "", link: "" },
  ]);
  assert.throws(() => parseScheduleInput({ ...input, reservationContacts: [{ name: "Restaurant", link: "javascript:alert(1)" }] }), /valid HTTP or HTTPS URL/);
});
