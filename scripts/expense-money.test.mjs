import assert from "node:assert/strict";
import test from "node:test";
import { formatAverageAmount, formatMinorAmount, parseExpenseAmount, summarizeExpenses } from "../lib/expense-money.mjs";

test("expense amounts use integer minor units for all supported currencies", () => {
  assert.deepEqual(parseExpenseAmount("1200", "JPY"), { minor: "1200", amount: "1200" });
  assert.deepEqual(parseExpenseAmount("25000", "VND"), { minor: "25000", amount: "25000" });
  assert.deepEqual(parseExpenseAmount("12.5", "USD"), { minor: "1250", amount: "12.50" });
  assert.equal(formatMinorAmount("1250", "USD"), "12.50");
  assert.throws(() => parseExpenseAmount("1.2", "JPY"), /whole number/);
  assert.throws(() => parseExpenseAmount("1.234", "USD"), /at most 2/);
  assert.throws(() => parseExpenseAmount("0", "VND"), /positive/);
  assert.throws(() => parseExpenseAmount("-1", "USD"), /greater than 0/);
});

test("averages and member differences include members who spent zero", () => {
  const summary = summarizeExpenses({
    currency: "JPY",
    members: [
      { email: "a@example.com", displayName: "A" },
      { email: "b@example.com", displayName: "B" },
      { email: "c@example.com", displayName: "C" },
    ],
    expenses: [
      { activityId: "10", payerEmail: "a@example.com", amountMinor: "100" },
      { activityId: "11", payerEmail: "b@example.com", amountMinor: "20" },
    ],
  });
  assert.equal(summary.totalAmount, "120");
  assert.equal(summary.averageAmount, "40");
  assert.deepEqual(summary.activityTotals, { 10: "100", 11: "20" });
  assert.deepEqual(summary.members.map(({ totalAmount, differenceAmount, comparison }) => ({ totalAmount, differenceAmount, comparison })), [
    { totalAmount: "100", differenceAmount: "60", comparison: "more" },
    { totalAmount: "20", differenceAmount: "-20", comparison: "less" },
    { totalAmount: "0", differenceAmount: "-40", comparison: "less" },
  ]);
  assert.equal(formatAverageAmount(100n, 3, "JPY"), "33.33");
  assert.equal(formatAverageAmount(-100n, 3, "JPY"), "-33.33");
});
