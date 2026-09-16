import { formatMinorAmount, summarizeExpenses } from "./expense-money.mjs";

const asIso = (value) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export function buildExpenseAssistantContext({ currency, members, activityTotals, entries, entryLimit = 200 }) {
  const summary = summarizeExpenses({
    currency,
    members: members.map((member) => ({
      email: member.email,
      displayName: member.displayName,
      role: member.role,
    })),
    expenses: members
      .filter((member) => BigInt(member.amountMinor) > 0n)
      .map((member) => ({ activityId: "all", payerEmail: member.email, amountMinor: member.amountMinor })),
  });
  const visibleEntries = entries.slice(0, entryLimit);
  return {
    currency,
    totalAmount: summary.totalAmount,
    averageAmount: summary.averageAmount,
    participantCount: summary.participantCount,
    members: summary.members.map(({ email: _email, ...member }) => member),
    activities: activityTotals.map((activity) => ({
      activityId: String(activity.activityId),
      title: activity.title,
      totalAmount: formatMinorAmount(activity.amountMinor, currency),
      expenseCount: Number(activity.expenseCount),
    })),
    recentEntries: visibleEntries.map((entry) => ({
      activityId: String(entry.activityId),
      activityTitle: entry.activityTitle,
      payer: entry.payerName,
      amount: formatMinorAmount(entry.amountMinor, currency),
      recordedBy: entry.creatorName,
      createdAt: asIso(entry.createdAt),
      updatedAt: asIso(entry.updatedAt),
    })),
    recentEntriesTruncated: entries.length > entryLimit,
  };
}

export async function readExpenseAssistantContext(sql, tripId, currency, { entryLimit = 200 } = {}) {
  const [memberRows, activityRows, entryRows] = await Promise.all([
    sql`SELECT participant.user_email AS email,participant.role,
      COALESCE(NULLIF(BTRIM(user_row.display_name),''),NULLIF(BTRIM(user_row.name),''),'Thành viên') AS display_name,
      COALESCE(SUM(expense.amount_minor),0)::TEXT AS amount_minor
      FROM trip_participants participant
      LEFT JOIN users user_row ON user_row.email=participant.user_email
      LEFT JOIN activity_expenses expense ON expense.trip_id=participant.trip_id AND expense.payer_email=participant.user_email
      WHERE participant.trip_id=${tripId}
      GROUP BY participant.user_email,participant.role,user_row.display_name,user_row.name
      ORDER BY CASE participant.role WHEN 'leader' THEN 0 ELSE 1 END,
        LOWER(COALESCE(NULLIF(BTRIM(user_row.display_name),''),NULLIF(BTRIM(user_row.name),''),'Thành viên'))`,
    sql`SELECT activity.id AS activity_id,activity.title,
      SUM(expense.amount_minor)::TEXT AS amount_minor,COUNT(expense.id)::INTEGER AS expense_count
      FROM activity_expenses expense JOIN activities activity ON activity.id=expense.activity_id AND activity.trip_id=expense.trip_id
      WHERE expense.trip_id=${tripId}
      GROUP BY activity.id,activity.title ORDER BY activity.start_date,activity.start_time,activity.sort_order,activity.id`,
    sql`SELECT expense.activity_id,activity.title AS activity_title,expense.amount_minor,
      COALESCE(NULLIF(BTRIM(payer.display_name),''),NULLIF(BTRIM(payer.name),''),'Thành viên') AS payer_name,
      COALESCE(NULLIF(BTRIM(creator.display_name),''),NULLIF(BTRIM(creator.name),''),'Thành viên') AS creator_name,
      expense.created_at,expense.updated_at
      FROM activity_expenses expense
      JOIN activities activity ON activity.id=expense.activity_id AND activity.trip_id=expense.trip_id
      LEFT JOIN users payer ON payer.email=expense.payer_email
      LEFT JOIN users creator ON creator.email=expense.created_by_email
      WHERE expense.trip_id=${tripId}
      ORDER BY expense.created_at DESC,expense.id DESC LIMIT ${entryLimit + 1}`,
  ]);
  return buildExpenseAssistantContext({
    currency,
    entryLimit,
    members: memberRows.map((row) => ({
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      amountMinor: row.amount_minor,
    })),
    activityTotals: activityRows.map((row) => ({
      activityId: row.activity_id,
      title: row.title,
      amountMinor: row.amount_minor,
      expenseCount: row.expense_count,
    })),
    entries: entryRows.map((row) => ({
      activityId: row.activity_id,
      activityTitle: row.activity_title,
      payerName: row.payer_name,
      creatorName: row.creator_name,
      amountMinor: row.amount_minor,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}
