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
  /** Max attempts per call (including the first). Default 3. */
  maxAttempts?: number;
}

export function createErpNextClient(options: ErpNextClientOptions): ErpNextClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  const retryPolicy = retry(handleWhen(isRetryable), {
    maxAttempts: (options.maxAttempts ?? 3) - 1,
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

  circuitBreakerPolicy.onBreak(() => logger.warn('erpnext_client.circuit_open'));
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
        throw new ErpNextApiError(
          `ERPNext request to ${path} failed with status ${response.status}`,
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
