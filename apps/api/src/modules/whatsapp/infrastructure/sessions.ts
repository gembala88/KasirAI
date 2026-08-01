/**
 * SQLite-backed session, conversation history, and notification-log
 * storage (spec §5: whatsapp_sessions, ai_conversation_log,
 * notification_log — none of these are ERPNext's concern).
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../../../shared/database/index.js';
import type { ConversationLogEntry, WhatsAppSession } from '../domain/index.js';

interface SessionRow {
  phone_number: string;
  customer_id: string | null;
  state: string;
}

export function getOrCreateSession(phoneNumber: string): WhatsAppSession {
  const db = getDb();
  const existing = db
    .prepare('SELECT phone_number, customer_id, state FROM whatsapp_sessions WHERE phone_number = ?')
    .get(phoneNumber) as SessionRow | undefined;

  if (existing) {
    return {
      phoneNumber: existing.phone_number,
      customerId: existing.customer_id ?? undefined,
      state: JSON.parse(existing.state) as Record<string, unknown>,
    };
  }

  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO whatsapp_sessions (phone_number, customer_id, state, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)',
  ).run(phoneNumber, '{}', now, now);

  return { phoneNumber, customerId: undefined, state: {} };
}

export function updateSession(
  phoneNumber: string,
  updates: { customerId?: string; state?: Record<string, unknown> },
): void {
  const db = getDb();
  const current = getOrCreateSession(phoneNumber);
  const customerId = updates.customerId ?? current.customerId ?? null;
  const state = JSON.stringify(updates.state ?? current.state);

  db.prepare(
    'UPDATE whatsapp_sessions SET customer_id = ?, state = ?, updated_at = ? WHERE phone_number = ?',
  ).run(customerId, state, new Date().toISOString(), phoneNumber);
}

export function appendConversationLog(
  phoneNumber: string,
  role: ConversationLogEntry['role'],
  content: string,
): void {
  getDb()
    .prepare(
      'INSERT INTO ai_conversation_log (id, phone_number, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(randomUUID(), phoneNumber, role, content, new Date().toISOString());
}

interface ConversationLogRow {
  role: string;
  content: string;
  created_at: string;
}

export function getRecentConversation(phoneNumber: string, limit: number): ConversationLogEntry[] {
  const rows = getDb()
    .prepare(
      'SELECT role, content, created_at FROM ai_conversation_log WHERE phone_number = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(phoneNumber, limit) as unknown as ConversationLogRow[];

  return rows
    .reverse()
    .map((row) => ({
      role: row.role as ConversationLogEntry['role'],
      content: row.content,
      createdAt: row.created_at,
    }));
}

export function logNotification(
  phoneNumber: string,
  direction: 'inbound' | 'outbound',
  messageType: string,
  content: string,
  status: string,
): void {
  getDb()
    .prepare(
      'INSERT INTO notification_log (id, phone_number, direction, message_type, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(randomUUID(), phoneNumber, direction, messageType, content, status, new Date().toISOString());
}
