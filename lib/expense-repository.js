import "server-only";

import { getSql } from "./db";
import { formatMinorAmount, parseExpenseAmount, summarizeExpenses } from "./expense-money.mjs";
import { requireTripAccess } from "./trip-access-repository";

const expenseError = (code, message) => Object.assign(new Error(message), { code });
const emailOf = (value) => String(value || "").trim().toLowerCase();

const actorFields = (viewer) => ({
  email: emailOf(viewer.email),
  name: viewer.displayName || viewer.name || viewer.email,
  role: viewer.isOwner ? "owner" : viewer.isAdmin ? "admin" : "member",
});

const expenseDto = (row, currency, revealEmail) => ({
  id: String(row.id),
  activityId: String(row.activity_id),
  payer: {
    displayName: row.payer_name,
    ...(revealEmail ? { email: row.payer_email } : {}),
  },
  amount: formatMinorAmount(row.amount_minor, currency),
  createdBy: { displayName: row.creator_name },
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const expenseSelect = (sql, tripId) => sql`
  SELECT expense.id,expense.activity_id,expense.payer_email,expense.amount_minor,
    expense.created_at,expense.updated_at,
    COALESCE(payer.display_name,payer.name,expense.payer_email) AS payer_name,
    COALESCE(creator.display_name,creator.name,expense.created_by_email) AS creator_name
  FROM activity_expenses expense
  LEFT JOIN users payer ON payer.email=expense.payer_email
  LEFT JOIN users creator ON creator.email=expense.created_by_email
  WHERE expense.trip_id=${tripId}
  ORDER BY expense.created_at,expense.id
`;

export async function listExpenses(viewer, slug) {
  const access = await requireTripAccess(viewer, slug);
  const [members, expenses] = await Promise.all([
    getSql()`SELECT participant.user_email AS email,participant.role,
      COALESCE(user_row.display_name,user_row.name,participant.user_email) AS display_name
      FROM trip_participants participant
      LEFT JOIN users user_row ON user_row.email=participant.user_email
      WHERE participant.trip_id=${access.trip.id}
      ORDER BY CASE participant.role WHEN 'leader' THEN 0 ELSE 1 END,
        LOWER(COALESCE(user_row.display_name,user_row.name,participant.user_email)),participant.user_email`,
    expenseSelect(getSql(), access.trip.id),
  ]);
  const summaryMembers = members.map((member) => ({
    email: member.email,
    displayName: member.display_name,
    role: member.role,
  }));
  const summary = summarizeExpenses({
    currency: access.trip.currency,
    members: summaryMembers,
    expenses: expenses.map((expense) => ({
      activityId: expense.activity_id,
      payerEmail: expense.payer_email,
      amountMinor: expense.amount_minor,
    })),
  });
  const revealEmail = access.canManageExpenses;
  return {
    currency: access.trip.currency,
    canManage: access.canManageExpenses,
    expenses: expenses.map((expense) => expenseDto(expense, access.trip.currency, revealEmail)),
    payers: revealEmail ? summaryMembers.map(({ email, displayName }) => ({ email, displayName })) : [],
    summary: {
      ...summary,
      members: summary.members.map(({ email, ...member }) => ({ ...member, ...(revealEmail ? { email } : {}) })),
    },
  };
}

export async function createExpense(viewer, slug, input) {
  const access = await requireTripAccess(viewer, slug, "manageExpenses");
  const actor = actorFields(viewer);
  const parsed = parseExpenseAmount(input.amount, access.trip.currency);
  const payerEmail = emailOf(input.payerEmail);
  const [activityRows, payerRows] = await Promise.all([
    getSql()`SELECT id FROM activities WHERE trip_id=${access.trip.id} AND id=${input.activityId}`,
    getSql()`SELECT user_email FROM trip_participants WHERE trip_id=${access.trip.id} AND user_email=${payerEmail}`,
  ]);
  if (!activityRows.length || !payerRows.length) {
    throw expenseError("EXPENSE_TARGET_INVALID", "Hoạt động hoặc người chi không thuộc chuyến đi này");
  }
  const rows = await getSql()`WITH inserted AS (
      INSERT INTO activity_expenses(trip_id,activity_id,payer_email,amount_minor,created_by_email,updated_by_email)
      VALUES(${access.trip.id},${input.activityId},${payerEmail},${parsed.minor}::BIGINT,${actor.email},${actor.email})
      RETURNING *
    ), audit AS (
      INSERT INTO trip_audit_events(trip_id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,action,entity_type,entity_id,after_value)
      SELECT trip_id,${access.trip.slug},${access.trip.title},${actor.email},${actor.name},${actor.role},'web','expense.created','expense',id::TEXT,
        jsonb_build_object('activityId',activity_id::TEXT,'payerEmail',payer_email,'amount',${parsed.amount}::TEXT,'currency',${access.trip.currency}::TEXT)
      FROM inserted RETURNING id
    ) SELECT * FROM inserted`;
  return { id: String(rows[0].id) };
}

export async function updateExpense(viewer, slug, expenseId, input) {
  const access = await requireTripAccess(viewer, slug, "manageExpenses");
  const actor = actorFields(viewer);
  const payerEmail = input.payerEmail === undefined ? null : emailOf(input.payerEmail);
  const parsed = input.amount === undefined ? null : parseExpenseAmount(input.amount, access.trip.currency);
  const rows = await getSql()`WITH target AS (
      SELECT * FROM activity_expenses WHERE id=${expenseId} AND trip_id=${access.trip.id} FOR UPDATE
    ), payer AS (
      SELECT user_email FROM trip_participants WHERE trip_id=${access.trip.id}
        AND user_email=COALESCE(${payerEmail},(SELECT payer_email FROM target))
    ), changed AS (
      UPDATE activity_expenses expense
      SET payer_email=payer.user_email,
        amount_minor=COALESCE(${parsed?.minor || null}::BIGINT,expense.amount_minor),
        updated_by_email=${actor.email},updated_at=NOW()
      FROM payer,target
      WHERE expense.id=target.id
      RETURNING expense.*
    ), audit AS (
      INSERT INTO trip_audit_events(trip_id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,action,entity_type,entity_id,before_value,after_value)
      SELECT changed.trip_id,${access.trip.slug},${access.trip.title},${actor.email},${actor.name},${actor.role},'web','expense.updated','expense',changed.id::TEXT,
        jsonb_build_object('payerEmail',target.payer_email,'amount',target.amount_minor),
        jsonb_build_object('payerEmail',changed.payer_email,'amount',changed.amount_minor)
      FROM changed,target RETURNING id
    ) SELECT * FROM changed`;
  if (!rows.length) {
    const existing = await getSql()`SELECT id FROM activity_expenses WHERE id=${expenseId} AND trip_id=${access.trip.id}`;
    if (!existing.length) throw expenseError("EXPENSE_NOT_FOUND", "Không tìm thấy khoản chi");
    throw expenseError("EXPENSE_PAYER_INVALID", "Người chi phải là thành viên hiện tại của chuyến đi");
  }
  return { id: String(rows[0].id) };
}

export async function deleteExpense(viewer, slug, expenseId) {
  const access = await requireTripAccess(viewer, slug, "manageExpenses");
  const actor = actorFields(viewer);
  const rows = await getSql()`WITH deleted AS (
      DELETE FROM activity_expenses WHERE id=${expenseId} AND trip_id=${access.trip.id} RETURNING *
    ), audit AS (
      INSERT INTO trip_audit_events(trip_id,trip_slug,trip_title,actor_email,actor_name,actor_role,source,action,entity_type,entity_id,before_value)
      SELECT trip_id,${access.trip.slug},${access.trip.title},${actor.email},${actor.name},${actor.role},'web','expense.deleted','expense',id::TEXT,
        jsonb_build_object('activityId',activity_id::TEXT,'payerEmail',payer_email,'amountMinor',amount_minor)
      FROM deleted RETURNING id
    ) SELECT * FROM deleted`;
  if (!rows.length) throw expenseError("EXPENSE_NOT_FOUND", "Không tìm thấy khoản chi");
}
