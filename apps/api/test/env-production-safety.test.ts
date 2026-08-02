import { describe, expect, it, vi } from 'vitest';
import { assertProductionSafety, env } from '../src/config/env.js';

function withOverrides(overrides: Partial<typeof env>): typeof env {
  return { ...env, NODE_ENV: 'production', ...overrides };
}

describe('assertProductionSafety', () => {
  it('does nothing outside production, even with every insecure default present', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertProductionSafety({
      ...env,
      NODE_ENV: 'development',
      JWT_SECRET: 'CHANGE_ME_TO_A_RANDOM_32_CHAR_MINIMUM_SECRET',
      ERPNEXT_WEBHOOK_SECRET: '',
    });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('refuses to boot in production with the placeholder JWT_SECRET', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertProductionSafety(
      withOverrides({
        JWT_SECRET: 'CHANGE_ME_TO_A_RANDOM_32_CHAR_MINIMUM_SECRET',
        ERPNEXT_WEBHOOK_SECRET: 'a-real-secret',
      }),
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('JWT_SECRET');
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('refuses to boot in production with no ERPNext webhook secret configured', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertProductionSafety(
      withOverrides({
        JWT_SECRET: 'a-real-32-character-minimum-secret-value',
        ERPNEXT_WEBHOOK_SECRET: '',
      }),
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('ERPNEXT_WEBHOOK_SECRET');
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('refuses to boot when WhatsApp is configured but its webhook secret is not', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertProductionSafety(
      withOverrides({
        JWT_SECRET: 'a-real-32-character-minimum-secret-value',
        ERPNEXT_WEBHOOK_SECRET: 'a-real-secret',
        WHATSAPP_ACCESS_TOKEN: 'real-token',
        WHATSAPP_APP_SECRET: '',
      }),
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain('WHATSAPP_APP_SECRET');
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('does not require a WhatsApp webhook secret when WhatsApp is not configured at all', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    assertProductionSafety(
      withOverrides({
        JWT_SECRET: 'a-real-32-character-minimum-secret-value',
        ERPNEXT_WEBHOOK_SECRET: 'a-real-secret',
        WHATSAPP_ACCESS_TOKEN: '',
        WHATSAPP_APP_SECRET: '',
      }),
    );

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('warns (but does not refuse to boot) on wildcard CORS in production', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    assertProductionSafety(
      withOverrides({
        JWT_SECRET: 'a-real-32-character-minimum-secret-value',
        ERPNEXT_WEBHOOK_SECRET: 'a-real-secret',
        CORS_ALLOWED_ORIGINS: true,
      }),
    );

    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]?.[0]).toContain('CORS_ALLOWED_ORIGINS');
    exitSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('boots cleanly in production with a fully secure configuration', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    assertProductionSafety(
      withOverrides({
        JWT_SECRET: 'a-real-32-character-minimum-secret-value',
        ERPNEXT_WEBHOOK_SECRET: 'a-real-secret',
        WHATSAPP_ACCESS_TOKEN: 'real-token',
        WHATSAPP_APP_SECRET: 'a-real-secret',
        CORS_ALLOWED_ORIGINS: ['https://dashboard.example.com'],
      }),
    );

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
