import { describe, expect, it, vi } from 'vitest';
import { createSentryReporter, type SentryClient } from '../src/shared/observability/sentry.js';

function fakeClient(): SentryClient & {
  init: ReturnType<typeof vi.fn>;
  captureException: ReturnType<typeof vi.fn>;
  captureMessage: ReturnType<typeof vi.fn>;
} {
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    captureMessage: vi.fn(),
  };
}

describe('createSentryReporter', () => {
  it('is disabled and never touches the Sentry client when no DSN is configured', () => {
    const client = fakeClient();
    const reporter = createSentryReporter('', 'development', client);

    expect(reporter.enabled).toBe(false);
    expect(client.init).not.toHaveBeenCalled();

    reporter.captureException(new Error('boom'));
    reporter.captureMessage('something happened');

    expect(client.captureException).not.toHaveBeenCalled();
    expect(client.captureMessage).not.toHaveBeenCalled();
  });

  it('initializes the real client and forwards captures when a DSN is configured', () => {
    const client = fakeClient();
    const reporter = createSentryReporter('https://fake@sentry.example/1', 'production', client);

    expect(reporter.enabled).toBe(true);
    expect(client.init).toHaveBeenCalledWith({
      dsn: 'https://fake@sentry.example/1',
      environment: 'production',
      tracesSampleRate: 0,
    });

    const error = new Error('boom');
    reporter.captureException(error, { jobId: '123' });
    expect(client.captureException).toHaveBeenCalledWith(error, { extra: { jobId: '123' } });

    reporter.captureMessage('circuit open', { provider: 'erpnext' });
    expect(client.captureMessage).toHaveBeenCalledWith('circuit open', {
      extra: { provider: 'erpnext' },
    });
  });

  it('omits the hint entirely when no extra context is passed', () => {
    const client = fakeClient();
    const reporter = createSentryReporter('https://fake@sentry.example/1', 'production', client);

    reporter.captureException(new Error('boom'));
    expect(client.captureException).toHaveBeenCalledWith(expect.any(Error), undefined);
  });
});
