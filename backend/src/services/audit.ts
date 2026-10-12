import { randomUUID } from "node:crypto";
import { db } from "../db/database.js";

export function enqueueBotEvent(eventType: string, payload: Record<string, unknown>) {
  const now = new Date().toISOString();
  return db.prepare(`
    INSERT INTO bot_outbox (event_type, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(eventType, JSON.stringify(payload), now, now);
}

export function recordAudit(
  eventType: string,
  actorUserId: number | null,
  targetUserId: number | null,
  details: Record<string, unknown>
) {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO audit_log (
      event_id, actor_user_id, event_type, target_user_id, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    actorUserId,
    eventType,
    targetUserId,
    JSON.stringify(details),
    createdAt
  );
  if (
    eventType.startsWith("security.") &&
    eventType !== "security.discord_delivery_failed"
  ) {
    enqueueBotEvent("security_incident", {
      eventType,
      actorUserId,
      targetUserId,
      details,
      createdAt,
    });
  }
}
