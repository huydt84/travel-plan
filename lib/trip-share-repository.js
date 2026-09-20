import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getSql } from "./db";
import { ValidationError } from "./validation";

const hashShareToken = (token) => createHash("sha256").update(token).digest("hex");
const validShareToken = (token) => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

export async function createTripShareLink(tripId, actorEmail, minutes = 10) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    throw new ValidationError("minutes must be an integer between 1 and 60");
  }
  const token = randomBytes(32).toString("base64url");
  const [row] = await getSql()`
    INSERT INTO trip_share_links(token_hash, trip_id, created_by_email, expires_at)
    VALUES (${hashShareToken(token)}, ${tripId}, ${actorEmail.toLowerCase()}, NOW() + (${minutes} * INTERVAL '1 minute'))
    RETURNING expires_at
  `;
  return { token, expiresAt: new Date(row.expires_at).toISOString() };
}

export async function resolveTripShareLink(token) {
  if (!validShareToken(token)) return null;
  const [row] = await getSql()`
    SELECT trip.slug, link.expires_at, ROUND(EXTRACT(EPOCH FROM (link.expires_at - link.created_at)) / 60)::INTEGER AS minutes
    FROM trip_share_links link
    JOIN trips trip ON trip.id = link.trip_id
    WHERE link.token_hash = ${hashShareToken(token)} AND link.expires_at > NOW()
    LIMIT 1
  `;
  return row ? { slug: row.slug, expiresAt: new Date(row.expires_at).toISOString(), minutes: row.minutes } : null;
}
