import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  FRONTEND_ORIGINS: 'https://client.example',
  V2BOARD_BASE_URL: 'https://private.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'cf-ray': 'request-id',
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/v1/auth/login', () => {
  it('returns the public token contract for a valid payload', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: { auth_data: 'opaque-token', token: 'ignored-token' } })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'password123',
        }),
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        accessToken: 'opaque-token',
        tokenType: 'Bearer',
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it('accepts a valid email at the 254-character boundary', async () => {
    const email = `${'a'.repeat(242)}@example.com`;
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: { auth_data: 'opaque-token' } })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({ email, password: 'password123' }),
      },
      env
    );

    expect(email).toHaveLength(254);
    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it('rejects a valid-format 255-character email before upstream', async () => {
    const email = `${'a'.repeat(243)}@example.com`;
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({ email, password: 'password123' }),
      },
      env
    );

    expect(email).toHaveLength(255);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing email', { password: 'password123' }],
    ['missing password', { email: 'user@example.com' }],
    ['invalid email format', { email: 'not-an-email', password: 'password123' }],
    ['short password', { email: 'user@example.com', password: 'short' }],
    ['long password', { email: 'user@example.com', password: 'x'.repeat(1025) }],
    [
      'unknown field',
      { email: 'user@example.com', password: 'password123', remember: true },
    ],
  ])('rejects %s without contacting V2Board', async (_case, body) => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify(body),
      },
      env
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        requestId: 'request-id',
      },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    'Incorrect email or password',
    'Your account has been suspended',
    'There are too many password errors, please try again after 30 minutes.',
    '密码错误次数过多，请 30 分钟后再试',
  ])('maps a known V2Board auth rejection without exposing: %s', async (message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    const response = await app.request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'password123',
        }),
      },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'AUTH_FAILED',
        message: 'Authentication failed',
        requestId: 'request-id',
      },
    });
  });

  it('does not map a login limit prefix near-miss to AUTH_FAILED', async () => {
    const message = 'There are too many password errors SOMETHING ELSE';
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    const response = await app.request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'password123',
        }),
      },
      env
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('UPSTREAM_ERROR');
    expect(body).not.toContain(message);
  });

  it('maps an upstream validation error to the public validation contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ errors: { email: ['internal detail'] } }, 422)
      )
    );

    const response = await app.request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'password123',
        }),
      },
      env
    );

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain('VALIDATION_ERROR');
    expect(body).not.toContain('internal detail');
  });

  it('normalizes an unknown JSON 500 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'SQL connection failed' }, 500)
      )
    );

    const response = await app.request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: requestHeaders(),
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'password123',
        }),
      },
      env
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('UPSTREAM_ERROR');
    expect(body).not.toContain('SQL connection failed');
  });
});

describe('GET /api/v1/me', () => {
  it('maps an authorized V2Board user to the public user DTO', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T00:00:00.000Z'));
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          email: 'user@example.com',
          uuid: 'must-not-leak',
          expired_at: 1893456000,
          banned: 0,
          balance: 10000,
          is_admin: true,
        },
      })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/me',
      {
        headers: {
          Authorization: 'Bearer opaque-token',
          'cf-ray': 'request-id',
        },
      },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        email: 'user@example.com',
        expiresAt: '2030-01-01T00:00:00.000Z',
        status: 'active',
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');

    const [, init] = upstreamFetch.mock.calls[0];
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it('rejects a missing Authorization header without contacting V2Board', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/me',
      { headers: { 'cf-ray': 'request-id' } },
      env
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each(['invalid token', 'expired session'])('maps %s to AUTH_FAILED', async (message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 403))
    );

    const response = await app.request(
      '/api/v1/me',
      {
        headers: {
          Authorization: 'Bearer opaque-token',
          'cf-ray': 'request-id',
        },
      },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: 'AUTH_FAILED',
        message: 'Authentication failed',
        requestId: 'request-id',
      },
    });
  });

  it('does not mistake a non-JSON Access 403 for user auth failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>Access denied</h1>', {
          status: 403,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    );

    const response = await app.request(
      '/api/v1/me',
      {
        headers: {
          Authorization: 'Bearer opaque-token',
          'cf-ray': 'request-id',
        },
      },
      env
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('UPSTREAM_ERROR');
    expect(body).not.toContain('Access denied');
  });

  it('normalizes an unknown upstream error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>Laravel exception</h1>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    );

    const response = await app.request(
      '/api/v1/me',
      {
        headers: {
          Authorization: 'Bearer opaque-token',
          'cf-ray': 'request-id',
        },
      },
      env
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('UPSTREAM_ERROR');
    expect(body).not.toContain('Laravel exception');
    expect(body).not.toContain('private.example');
  });
});
