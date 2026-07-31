/**
 * AI Gateway — action validation layer (FR-5, §3.1, §8.2).
 *
 * Every write-type action the AI proposes (Sales Order, Quotation, stock
 * change) is structured JSON that must pass through here — checking stock
 * availability, price correctness, and MOQ — before it is ever sent to
 * ERPNext. The AI never writes directly to the database; this is the
 * enforcement point for that rule, independent of which provider produced
 * the proposal.
 *
 * This is a Phase 4 deliverable (§10).
 */
export {};
