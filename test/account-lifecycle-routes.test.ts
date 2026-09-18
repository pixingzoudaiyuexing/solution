import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

const env = {
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-ray': 'request-id' },
      body: JSON.stringify(body),
    },
    env
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/v1/auth/email-code', () => {
  it('returns the public sent contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: true }))
    );
    const response = await post('/api/v1/auth/email-code', {
      email: 'user@example.com',
      purpose: 'register',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { sent: true },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['invalid purpose', { email: 'user@example.com', purpose: 'login' }],
    ['invalid email', { email: 'invalid', purpose: 'register' }],
    ['invalid challenge token type', { email: 'user@example.com', purpose: 'register', challengeToken: 1 }],
    ['empty challenge token', { email: 'user@example.com', purpose: 'register', challengeToken: '' }],
    ['oversized challenge token', { email: 'user@example.com', purpose: 'register', challengeToken: 'x'.repeat(4097) }],
    ['provider-specific legacy field', { email: 'user@example.com', purpose: 'register', recaptchaData: 'legacy-value' }],
    ['provider-specific token field', { email: 'user@example.com', purpose: 'register', recaptchaToken: 'legacy-value' }],
    ['provider-specific response field', { email: 'user@example.com', purpose: 'register', gRecaptchaResponse: 'legacy-value' }],
  ])('rejects %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await post('/api/v1/auth/email-code', body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps upstream rate limiting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Too many requests, please try again later.' }, 429)
      )
    );
    const response = await post('/api/v1/auth/email-code', {
      email: 'user@example.com',
      purpose: 'password-reset',
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
});

describe('POST /api/v1/auth/register', () => {
  it('returns the same opaque auth DTO as login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: { auth_data: 'opaque-auth-data', token: 'private' } })
      )
    );
    const response = await post('/api/v1/auth/register', {
      email: 'user@example.com',
      password: 'password123',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { accessToken: 'opaque-auth-data', tokenType: 'Bearer' },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['invalid email', { email: 'invalid', password: 'password123' }],
    ['short password', { email: 'user@example.com', password: '1234567' }],
    ['long password', { email: 'user@example.com', password: 'x'.repeat(65) }],
    ['bad email code', { email: 'user@example.com', password: 'password123', emailCode: '12345' }],
    ['long invite', { email: 'user@example.com', password: 'password123', inviteCode: 'x'.repeat(256) }],
    ['bad challenge token', { email: 'user@example.com', password: 'password123', challengeToken: 1 }],
    ['provider-specific legacy field', { email: 'user@example.com', password: 'password123', recaptchaData: 'legacy-value' }],
    ['provider-specific token field', { email: 'user@example.com', password: 'password123', recaptchaToken: 'legacy-value' }],
    ['provider-specific response field', { email: 'user@example.com', password: 'password123', gRecaptchaResponse: 'legacy-value' }],
  ])('rejects %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await post('/api/v1/auth/register', body);
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['Email already exists', 'REGISTRATION_UNAVAILABLE', 409],
    ['Registration has closed', 'REGISTRATION_UNAVAILABLE', 409],
    ['Incorrect email verification code', 'VERIFICATION_FAILED', 422],
  ] as const)('normalizes %s', async (message, code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    const response = await post('/api/v1/auth/register', {
      email: 'user@example.com',
      password: 'password123',
    });
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).toContain(code);
    expect(text).not.toContain(message);
  });
});

describe('POST /api/v1/auth/password/reset', () => {
  it('returns reset=true without automatically logging in', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true }));
    vi.stubGlobal('fetch', fetcher);
    const response = await post('/api/v1/auth/password/reset', {
      email: 'user@example.com',
      emailCode: '123456',
      newPassword: 'new-password123',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { reset: true },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['invalid email', { email: 'invalid', emailCode: '123456', newPassword: 'new-password123' }],
    ['bad email code', { email: 'user@example.com', emailCode: '12345', newPassword: 'new-password123' }],
    ['short password', { email: 'user@example.com', emailCode: '123456', newPassword: '1234567' }],
    ['long password', { email: 'user@example.com', emailCode: '123456', newPassword: 'x'.repeat(65) }],
    ['challenge token', { email: 'user@example.com', emailCode: '123456', newPassword: 'new-password123', challengeToken: 'token' }],
  ])('rejects %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await post('/api/v1/auth/password/reset', body);
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['Incorrect email verification code', 'VERIFICATION_FAILED', 422],
    ['This email is not registered in the system', 'PASSWORD_RESET_FAILED', 422],
    ['Reset failed, Please try again later', 'RATE_LIMITED', 429],
  ] as const)('normalizes %s', async (message, code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    const response = await post('/api/v1/auth/password/reset', {
      email: 'user@example.com',
      emailCode: '123456',
      newPassword: 'new-password123',
    });
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).toContain(code);
    expect(text).not.toContain(message);
  });
});
