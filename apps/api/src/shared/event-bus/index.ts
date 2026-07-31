/**
 * Cross-module communication boundary (§3.3 of the spec).
 *
 * Synchronous, in-process calls between modules should go through explicit
 * application-layer interfaces instead of this bus. This bus is for
 * eventually-consistent, fire-and-forget notifications between modules
 * (e.g. inventory -> notification on low stock).
 *
 * The Phase 0 implementation is in-memory only. A BullMQ/Redis-backed
 * implementation of this same interface lands once the first async workflow
 * (WhatsApp notifications, piutang reminders) is built — see §10 Phase 3+.
 */
import { EventEmitter } from 'node:events';

export interface DomainEvent<TPayload = unknown> {
  name: string;
  payload: TPayload;
  occurredAt: Date;
}

export interface EventBus {
  publish<TPayload>(name: string, payload: TPayload): void;
  subscribe<TPayload>(name: string, handler: (event: DomainEvent<TPayload>) => void): void;
}

class InMemoryEventBus implements EventBus {
  private readonly emitter = new EventEmitter();

  publish<TPayload>(name: string, payload: TPayload): void {
    const event: DomainEvent<TPayload> = { name, payload, occurredAt: new Date() };
    this.emitter.emit(name, event);
  }

  subscribe<TPayload>(name: string, handler: (event: DomainEvent<TPayload>) => void): void {
    this.emitter.on(name, handler);
  }
}

export const eventBus: EventBus = new InMemoryEventBus();
