import { NextResponse } from "next/server";
import { ValidationError } from "./validation";

export function apiError(error) {
  if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error.code === "NOTIFICATION_CURSOR_INVALID") return NextResponse.json({ error: error.message }, { status: 400 });
  if (error.code === "TRIP_NOT_FOUND" || error.code === "SCHEDULE_NOT_FOUND" || error.code === "BRANCH_GROUP_NOT_FOUND" || error.code === "BRANCH_NOT_FOUND" || error.code === "SUGGESTION_NOT_FOUND" || error.code === "NOTIFICATION_NOT_FOUND") {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error.code === "SUGGESTION_FORBIDDEN") return NextResponse.json({ error: error.message }, { status: 403 });
  if (error.code === "USER_NOT_FOUND") return NextResponse.json({ error: error.message }, { status: 404 });
  if (error.code === "USER_ROLE_OWNER_IMMUTABLE") return NextResponse.json({ error: error.message }, { status: 403 });
  if (error.code === "23505") return NextResponse.json({ error: "Resource already exists" }, { status: 409 });
  if (error.code === "INVALID_SOURCE_REFS") return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ error: "Database operation failed" }, { status: 503 });
}
