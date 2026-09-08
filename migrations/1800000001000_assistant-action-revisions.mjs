import { migrationSql } from "./support.mjs";

export const down = false;

export async function up(pgm) {
  const sql = migrationSql(pgm);

  await sql`ALTER TABLE assistant_actions ADD COLUMN IF NOT EXISTS revision_number INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE assistant_actions ADD COLUMN IF NOT EXISTS supersedes_action_id UUID REFERENCES assistant_actions(id)`;
  await sql`ALTER TABLE assistant_actions DROP CONSTRAINT IF EXISTS assistant_actions_status_check`;
  await sql`ALTER TABLE assistant_actions ADD CONSTRAINT assistant_actions_status_check CHECK(status IN ('pending','applied','rejected','expired','conflicted','cancelled','failed','superseded'))`;
  await sql`ALTER TABLE assistant_actions DROP CONSTRAINT IF EXISTS assistant_actions_turn_id_segment_key`;
  await sql`DROP INDEX IF EXISTS assistant_actions_turn_segment_revision_idx`;
  await sql`CREATE UNIQUE INDEX assistant_actions_turn_segment_revision_idx ON assistant_actions(turn_id,segment,revision_number)`;
  await sql`DROP INDEX IF EXISTS assistant_actions_one_pending_idx`;
  await sql`CREATE UNIQUE INDEX assistant_actions_one_pending_idx ON assistant_actions(turn_id,segment) WHERE status='pending'`;
}
