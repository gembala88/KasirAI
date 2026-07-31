/**
 * Single shared ERPNext API client boundary (§5, §10 Phase 1).
 *
 * ERPNext is the source of truth for all business data — no module may call
 * the Frappe REST API directly; every module depends on this interface only.
 * This keeps retry/backoff, circuit-breaking, and auth token handling
 * (NFR "Resilience", §1.4) in exactly one place.
 *
 * Phase 0 defines the contract only. The concrete implementation (HTTP
 * client, retry-with-backoff, circuit breaker) is a Phase 1 deliverable,
 * built once real ERPNext doctypes/custom fields exist to call against.
 */
export interface ErpNextClient {
  get<TResponse>(doctype: string, name: string): Promise<TResponse>;
  list<TResponse>(doctype: string, params?: Record<string, unknown>): Promise<TResponse[]>;
  create<TResponse>(doctype: string, payload: Record<string, unknown>): Promise<TResponse>;
  update<TResponse>(
    doctype: string,
    name: string,
    payload: Record<string, unknown>,
  ): Promise<TResponse>;
  delete(doctype: string, name: string): Promise<void>;
}
