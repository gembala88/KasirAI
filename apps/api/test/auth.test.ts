import { beforeEach, describe, expect, it, vi } from 'vitest';

const erpNextClientMock = {
  get: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../src/shared/erpnext-client/index.js', () => ({
  erpNextClient: erpNextClientMock,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { login, refreshAccessToken } = await import('../src/modules/auth/application/index.js');
const { issueTokenPair, requireRole } = await import('../src/modules/auth/interfaces/index.js');
const { verifyAccessToken: verifyAccessTokenForTest } =
  await import('../src/modules/auth/infrastructure/jwt.js');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login', () => {
  it('rejects wrong credentials without revealing whether the account exists', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Invalid login credentials' }));

    await expect(login('nobody@hermes.local', 'wrong')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid email or password',
    });
    expect(erpNextClientMock.get).not.toHaveBeenCalled();
  });

  it('rejects a valid ERPNext login that has no hermes_role assigned — same error as wrong credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { message: 'Logged In', full_name: 'Nobody' }));
    erpNextClientMock.get.mockResolvedValue({ enabled: 1, hermes_role: undefined });

    await expect(login('unprovisioned@hermes.local', 'correct')).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid email or password',
    });
  });

  it('rejects a disabled ERPNext user even with a hermes_role set', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { message: 'Logged In', full_name: 'Disabled' }));
    erpNextClientMock.get.mockResolvedValue({ enabled: 0, hermes_role: 'Owner' });

    await expect(login('disabled@hermes.local', 'correct')).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('issues a real token pair for a valid, provisioned user', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { message: 'Logged In', full_name: 'Budi Owner' }),
    );
    erpNextClientMock.get.mockResolvedValue({ enabled: 1, hermes_role: 'Owner' });

    const result = await login('owner@hermes.local', 'correct');

    expect(result.user).toEqual({
      email: 'owner@hermes.local',
      fullName: 'Budi Owner',
      role: 'Owner',
    });
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
    expect(verifyAccessTokenForTest(result.accessToken)).toMatchObject({ role: 'Owner' });
  });
});

describe('refreshAccessToken', () => {
  it('issues a new access token from a valid refresh token', () => {
    const { refreshToken } = issueTokenPair({
      email: 'cashier@hermes.local',
      fullName: 'Cashier',
      role: 'Cashier',
    });
    const result = refreshAccessToken(refreshToken);
    expect(result.user.role).toBe('Cashier');
    expect(verifyAccessTokenForTest(result.accessToken)).toMatchObject({ role: 'Cashier' });
  });

  it('rejects an access token presented as a refresh token (type confusion)', () => {
    const { accessToken } = issueTokenPair({
      email: 'x@hermes.local',
      fullName: 'X',
      role: 'Owner',
    });
    expect(() => refreshAccessToken(accessToken)).toThrow(/Invalid or expired token/);
  });
});

describe('requireRole', () => {
  function fakeRequest(role: string | undefined) {
    return { user: role ? { email: 'x@hermes.local', fullName: 'X', role } : undefined } as never;
  }

  it('allows a request whose role is in the allowed list', async () => {
    await expect(requireRole('Owner', 'Manager')(fakeRequest('Manager'))).resolves.toBeUndefined();
  });

  it('rejects a request whose role is not in the allowed list', async () => {
    await expect(requireRole('Owner', 'Manager')(fakeRequest('Cashier'))).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('rejects a request with no authenticated user at all', async () => {
    await expect(requireRole('Owner')(fakeRequest(undefined))).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
