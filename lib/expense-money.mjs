export const EXPENSE_CURRENCIES = Object.freeze(["VND", "JPY", "USD"]);

const exponentFor = (currency) => currency === "USD" ? 2 : 0;

const assertCurrency = (currency) => {
  if (!EXPENSE_CURRENCIES.includes(currency)) throw new Error(`Unsupported expense currency: ${currency}`);
};

export function parseExpenseAmount(value, currency) {
  assertCurrency(currency);
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== "string") throw new Error("amount must be a positive decimal value");
  const normalized = raw.trim();
  const exponent = exponentFor(currency);
  const pattern = exponent === 0 ? /^(?:0*[1-9]\d*)$/ : /^(?:\d+)(?:\.(\d{1,2}))?$/;
  const match = normalized.match(pattern);
  if (!match) throw new Error(currency === "USD"
    ? "amount must be greater than 0 with at most 2 decimal places"
    : `amount must be a positive whole number for ${currency}`);
  const [wholeRaw, fractionRaw = ""] = normalized.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionRaw.padEnd(exponent, "0");
  const minor = BigInt(`${whole}${fraction}`);
  if (minor <= 0n || minor > 9223372036854775807n) throw new Error("amount is outside the supported range");
  return { minor: minor.toString(), amount: formatMinorAmount(minor, currency) };
}

export function formatMinorAmount(value, currency) {
  assertCurrency(currency);
  const minor = BigInt(value);
  const exponent = exponentFor(currency);
  if (exponent === 0) return minor.toString();
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, "0");
  const result = `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
  return negative ? `-${result}` : result;
}

const divideRounded = (numerator, denominator) => {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
};

export function formatAverageAmount(numeratorMinor, denominator, currency) {
  assertCurrency(currency);
  if (!Number.isInteger(denominator) || denominator <= 0) return formatMinorAmount(0n, currency);
  const exponent = exponentFor(currency);
  const scaled = divideRounded(BigInt(numeratorMinor) * 100n, BigInt(denominator) * (10n ** BigInt(exponent)));
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(3, "0");
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2).replace(/0+$/, "");
  const result = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${result}` : result;
}

export function summarizeExpenses({ members, expenses, currency }) {
  assertCurrency(currency);
  const spentByEmail = new Map(members.map((member) => [member.email, 0n]));
  const byActivity = new Map();
  let total = 0n;
  for (const expense of expenses) {
    const amount = BigInt(expense.amountMinor);
    total += amount;
    spentByEmail.set(expense.payerEmail, (spentByEmail.get(expense.payerEmail) || 0n) + amount);
    byActivity.set(String(expense.activityId), (byActivity.get(String(expense.activityId)) || 0n) + amount);
  }
  const participantCount = members.length;
  return {
    totalAmount: formatMinorAmount(total, currency),
    averageAmount: formatAverageAmount(total, participantCount, currency),
    participantCount,
    activityTotals: Object.fromEntries([...byActivity].map(([activityId, amount]) => [activityId, formatMinorAmount(amount, currency)])),
    members: members.map((member) => {
      const spent = spentByEmail.get(member.email) || 0n;
      const differenceNumerator = spent * BigInt(participantCount) - total;
      return {
        ...member,
        totalAmount: formatMinorAmount(spent, currency),
        differenceAmount: formatAverageAmount(differenceNumerator, participantCount, currency),
        comparison: differenceNumerator === 0n ? "equal" : differenceNumerator > 0n ? "more" : "less",
      };
    }),
  };
}
