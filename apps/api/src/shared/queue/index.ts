/**
 * Shared Redis connection for BullMQ (spec §3.3: "Asynchronous (BullMQ +
 * Redis): anything that can be eventually consistent" — piutang reminders,
 * low-stock notifications, WhatsApp confirmations, receipt printing).
 *
 * Points at the `hermes-redis` service in infra/docker/docker-compose.yml,
 * not ERPNext's internal Redis instances (those aren't reachable from the
 * host and belong to Frappe's own workers only).
 */
import { Redis } from 'ioredis';
import { env } from '../../config/env.js';

let connection: Redis | undefined;

/** BullMQ requires `maxRetriesPerRequest: null` on the connection it's given. */
export function getRedisConnection(): Redis {
  connection ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}
