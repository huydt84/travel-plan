import assert from "node:assert/strict";
import test from "node:test";
import { formatAverageAmount, formatMinorAmount, parseExpenseAmount, summarizeExpenses } from "../lib/expense-money.mjs";
import { buildExpenseAssistantContext } from "../lib/expense-assistant-context.mjs";

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

test("assistant expense context exposes totals without member emails and marks truncated entries", () => {
  const context = buildExpenseAssistantContext({
    currency: "JPY",
    entryLimit: 1,
    members: [
      { email: "leader@example.com", displayName: "Leader", role: "leader", amountMinor: "300" },
      { email: "member@example.com", displayName: "Member", role: "member", amountMinor: "0" },
    ],
    activityTotals: [{ activityId: "7", title: "Dinner", amountMinor: "300", expenseCount: 2 }],
    entries: [
      { activityId: "7", activityTitle: "Dinner", payerName: "Leader", creatorName: "Member", amountMinor: "200", createdAt: "2030-01-01T10:00:00Z", updatedAt: "2030-01-01T10:00:00Z" },
      { activityId: "7", activityTitle: "Dinner", payerName: "Leader", creatorName: "Leader", amountMinor: "100", createdAt: "2030-01-01T09:00:00Z", updatedAt: "2030-01-01T09:00:00Z" },
    ],
  });
  assert.deepEqual(context.members, [
    { displayName: "Leader", role: "leader", totalAmount: "300", differenceAmount: "150", comparison: "more" },
    { displayName: "Member", role: "member", totalAmount: "0", differenceAmount: "-150", comparison: "less" },
  ]);
  assert.equal(context.totalAmount, "300");
  assert.equal(context.averageAmount, "150");
  assert.equal(context.activities[0].totalAmount, "300");
  assert.equal(context.recentEntries.length, 1);
  assert.equal(context.recentEntriesTruncated, true);
  assert.equal(JSON.stringify(context).includes("@example.com"), false);
});
