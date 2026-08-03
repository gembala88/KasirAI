/**
 * Single shared ERPNext API client (§5, §10 Phase 1).
 *
 * ERPNext is the source of truth for all business data — no module may call
 * the Frappe REST API directly; every module depends on this interface only.
 * That keeps retry/backoff, circuit-breaking, and auth token handling
 * (NFR "Resilience", §1.4) in exactly one place.
 *
 * Talks to Frappe's REST API (`/api/resource/<doctype>[/<name>]`) using
 * token auth (`Authorization: token <api_key>:<api_secret>`).
 */
import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  circuitBreaker,
  handleWhen,
  retry,
  wrap,
} from 'cockatiel';
import { env } from '../../config/env.js';
import { logger } from '../logger/index.js';
import { sentry } from '../observability/sentry.js';

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

export class ErpNextApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | undefined,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = 'ErpNextApiError';
  }
}

/**
 * Frappe's error responses bury the actually-useful, human-readable reason
 * (e.g. "Could not find Row #1: Item Code: 8997212800288") inside
 * `_server_messages` (a JSON-stringified array of JSON-stringified `{message}`
 * objects — the same field Frappe's own UI reads) or `exception` (a single
 * "ExceptionClassName: reason" line). Without this, every validation error —
 * wrong item code, negative stock, a missing warehouse — surfaced identically
 * as "ERPNext request to X failed with status 417", which is technically
 * true but tells a cashier/warehouse staff member nothing about what to fix.
 * Found live: a real scanned barcode with no matching ERPNext Item showed
 * only "Failed" in the offline queue, with the actual reason visible only in
 * server logs.
 */
function extractErpNextMessage(responseBody: string | undefined): string | undefined {
  if (!responseBody) return undefined;
  try {
    const parsed = JSON.parse(responseBody) as {
      _server_messages?: string;
      exception?: string;
      message?: string;
    };
    if (parsed._server_messages) {
      const messages = JSON.parse(parsed._server_messages) as string[];
      const first = messages[0];
      if (first) {
        const inner = JSON.parse(first) as { message?: string };
        if (inner.message) return inner.message;
      }
    }
    if (parsed.exception) {
      const separatorIndex = parsed.exception.indexOf(': ');
      return separatorIndex >= 0 ? parsed.exception.slice(separatorIndex + 2) : parsed.exception;
    }
    if (parsed.message) return parsed.message;
  } catch {
    // responseBody wasn't the JSON shape we expect (e.g. an HTML error
    // page from a proxy/gateway failure) — nothing to extract, fall back
    // to the generic status-code message.
  }
  return undefined;
}

/**
 * Only transient failures are worth retrying: network-level errors (no
 * status code — the request never got a response) and 5xx/429 from the
 * server. A 4xx like 404 or 417 (validation error) means the request itself
 * is wrong and retrying it will just fail the same way again.
 */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ErpNextApiError)) {
    return true;
  }
  return error.statusCode === undefined || error.statusCode === 429 || error.statusCode >= 500;
}

interface ErpNextClientOptions {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  fetchImpl?: typeof fetch;
  /** Consecutive transient failures before the circuit opens. Default 5. */
  circuitBreakerThreshold?: number;
  /** How long the circuit stays open before allowing a trial request. Default 10s. */
  circuitBreakerResetMs?: number;
  /**
   * Max attempts per call (including the first). Default 5 — found live
   * (Phase 8 load test) that the previous default of 3 wasn't enough
   * headroom for a real, genuinely transient failure mode: concurrent
   * Sales Invoice creation (3 simultaneous checkouts) hit MariaDB's
   * naming-series row lock and surfaced as a real
   * `frappe.exceptions.QueryDeadlockError` — a straightforward 500,
   * already correctly classified as retryable by `isRetryable`, but 2
   * retries (200ms-2000ms backoff) sometimes wasn't enough to outlast the
   * lock contention. Bumped generously since the cost of a couple more
   * fast retries on an already-rare event is negligible next to a checkout
   * failing outright.
   */
  maxAttempts?: number;
}

export function createErpNextClient(options: ErpNextClientOptions): ErpNextClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  const retryPolicy = retry(handleWhen(isRetryable), {
    maxAttempts: (options.maxAttempts ?? 5) - 1,
    backoff: new ExponentialBackoff({ initialDelay: 200, maxDelay: 2000 }),
  });

  const circuitBreakerPolicy = circuitBreaker(handleWhen(isRetryable), {
    halfOpenAfter: options.circuitBreakerResetMs ?? 10_000,
    breaker: new ConsecutiveBreaker(options.circuitBreakerThreshold ?? 5),
  });

  // Circuit breaker wraps retry: once open, calls fail fast without
  // burning through retry attempts; each individual attempt still reports
  // its outcome to the breaker.
  const resiliencePolicy = wrap(circuitBreakerPolicy, retryPolicy);

  circuitBreakerPolicy.onBreak(() => {
    logger.warn('erpnext_client.circuit_open');
    // ERPNext is the sole source of truth (§5) — every module depends on
    // it, so a breaker trip here means the whole app is degraded, not just
    // one request. Worth an alert even though no single exception caused it.
    sentry.captureMessage('erpnext_client.circuit_open');
  });
  circuitBreakerPolicy.onReset(() => logger.info('erpnext_client.circuit_closed'));

  async function request<TResponse>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<TResponse> {
    return resiliencePolicy.execute(async () => {
      let response: Response;
      try {
        const init: RequestInit = {
          method,
          headers: {
            Authorization: `token ${options.apiKey}:${options.apiSecret}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        };
        if (body !== undefined) {
          init.body = JSON.stringify(body);
        }
        response = await fetchImpl(`${options.baseUrl}${path}`, init);
      } catch (cause) {
        throw new ErpNextApiError(
          `ERPNext request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          undefined,
        );
      }

      if (!response.ok) {
        const responseBody = await response.text().catch(() => undefined);
        const detail = extractErpNextMessage(responseBody);
        throw new ErpNextApiError(
          detail
            ? `ERPNext request to ${path} failed with status ${response.status}: ${detail}`
            : `ERPNext request to ${path} failed with status ${response.status}`,
          response.status,
          responseBody,
        );
      }

      if (response.status === 204) {
        return undefined as TResponse;
      }

      const json = (await response.json()) as { data: TResponse };
      return json.data;
    });
  }

  return {
    async get<TResponse>(doctype: string, name: string): Promise<TResponse> {
      return request<TResponse>('GET', `/api/resource/${doctype}/${encodeURIComponent(name)}`);
    },

    async list<TResponse>(
      doctype: string,
      params: Record<string, unknown> = {},
    ): Promise<TResponse[]> {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        query.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      const queryString = query.toString();
      return request<TResponse[]>(
        'GET',
        `/api/resource/${doctype}${queryString ? `?${queryString}` : ''}`,
      );
    },

    async create<TResponse>(doctype: string, payload: Record<string, unknown>): Promise<TResponse> {
      return request<TResponse>('POST', `/api/resource/${doctype}`, payload);
    },

    async update<TResponse>(
      doctype: string,
      name: string,
      payload: Record<string, unknown>,
    ): Promise<TResponse> {
      return request<TResponse>(
        'PUT',
        `/api/resource/${doctype}/${encodeURIComponent(name)}`,
        payload,
      );
    },

    async delete(doctype: string, name: string): Promise<void> {
      await request<void>('DELETE', `/api/resource/${doctype}/${encodeURIComponent(name)}`);
    },
  };
}

export const erpNextClient: ErpNextClient = createErpNextClient({
  baseUrl: env.ERPNEXT_BASE_URL,
  apiKey: env.ERPNEXT_API_KEY,
  apiSecret: env.ERPNEXT_API_SECRET,
});
