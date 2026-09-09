import "server-only";
import { getSql } from "./db";
import { processAssistantHandoffOutboxRecords } from "./assistant-handoff-outbox-store.mjs";

export function processAssistantHandoffOutbox(options = {}, dependencies = {}) {
  return processAssistantHandoffOutboxRecords(dependencies.sql || getSql(), options, dependencies);
}
