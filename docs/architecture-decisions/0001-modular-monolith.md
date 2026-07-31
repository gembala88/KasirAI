# ADR 0001: Modular monolith instead of microservices

## Status

Accepted

## Context

The original brief sketched 13 separate deployable microservices. At current
transaction volume, that multiplies infrastructure and operational cost
(13 containers, 13 sets of logs, network hops, distributed tracing) without a
corresponding benefit.

## Decision

Build one deployable Fastify + TypeScript service, internally split into
strict domain modules under `apps/api/src/modules/*` (DDD-oriented: domain /
application / infrastructure / interfaces per module). Modules communicate
only through their `interfaces` boundary — never by importing another
module's internals directly.

## Consequences

- Extracting a module into its own service later is a mechanical refactor
  (swap the in-process call for an HTTP/queue call at the same boundary),
  not a rewrite.
- Trigger to actually split a module out: its load/scaling needs diverge
  significantly from the rest of the system (e.g. the AI Gateway getting hit
  far harder than POS).
- Until that trigger is hit, everything ships and scales as one service.

See spec §2.1 and §3.3.
