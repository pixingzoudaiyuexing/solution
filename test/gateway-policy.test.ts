import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { strictCors } from '../src/security/cors';

const env = {
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('gateway public CORS policy', () => {
  it.each([
    'https://example-test-origin.invalid',
    'https://another-frontend.example',
  ])('allows browser interoperability from arbitrary Origin %s', async (origin) => {
    const response = await app.request(
      '/api/v1/not-implemented',
      { headers: { Origin: origin } },
      env
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
    expect(response.headers.get('vary') ?? '').not.toContain('Origin');
  });

  it('sets public CORS even when the request has no Origin header', async () => {
    const response = await app.request('/api/v1/not-implemented', undefined, env);

    expect(response.status).toBe(404);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  });

  it.each([
    ['GET', '/api/v1/config/onboarding', undefined],
    ['POST', '/api/v1/auth/login', 'content-type'],
    ['PATCH', '/api/v1/me/preferences', 'authorization,content-type'],
  ])(
    'preserves %s preflight without credentialed CORS',
    async (method, path, requestHeaders) => {
      const headers = new Headers({
        Origin: 'https://example-test-origin.invalid',
        'Access-Control-Request-Method': method,
      });
      if (requestHeaders) {
        headers.set('Access-Control-Request-Headers', requestHeaders);
      }

      const response = await app.request(
        path,
        { method: 'OPTIONS', headers },
        env
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.has('access-control-allow-credentials')).toBe(
        false
      );
      expect(response.headers.get('access-control-allow-methods')).toBe(
        'GET,POST,PATCH,OPTIONS'
      );
      expect(response.headers.get('access-control-allow-methods')).toContain(
        method
      );
      expect(response.headers.get('access-control-allow-headers')).toBe(
        'Content-Type,Authorization'
      );
      expect(response.headers.get('access-control-max-age')).toBe('86400');
      expect(response.headers.get('vary') ?? '').not.toContain('Origin');
    }
  );

  it('strips downstream CORS and only removes Origin from Vary', async () => {
    const downstream = new Hono();
    downstream.use('*', strictCors);
    downstream.get('/', (c) =>
      c.text('ok', 200, {
        'Access-Control-Allow-Origin': 'https://internal.example',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'X-Internal',
        'Access-Control-Allow-Methods': 'DELETE',
        'Access-Control-Expose-Headers': 'X-Internal',
        'Access-Control-Max-Age': '1',
        Vary: 'Origin, Accept-Encoding',
      })
    );

    const response = await downstream.request('/', {
      headers: { Origin: 'https://example-test-origin.invalid' },
    });

    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
    expect(response.headers.has('access-control-allow-headers')).toBe(false);
    expect(response.headers.has('access-control-allow-methods')).toBe(false);
    expect(response.headers.has('access-control-expose-headers')).toBe(false);
    expect(response.headers.has('access-control-max-age')).toBe(false);
    expect(response.headers.get('vary')).toBe('Accept-Encoding');
  });
});

describe('CORS is not authentication', () => {
  it.each([
    ['no credential', {}],
    ['cookie only', { Cookie: 'some-session=value' }],
    ['malformed bearer', { Authorization: 'Basic not-a-bearer' }],
  ])('keeps a protected route closed for %s', async (_case, extraHeaders) => {
    const response = await app.request(
      '/api/v1/me',
      {
        headers: {
          Origin: 'https://evil.example',
          ...extraHeaders,
        },
      },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  });

  it('lets a valid Bearer reach the authenticated adapter from any Origin', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          email: 'user@example.com',
          expired_at: null,
          banned: 0,
        },
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/me',
      {
        headers: {
          Origin: 'https://new-disposable-frontend.example',
          Authorization: 'Bearer opaque-token',
        },
      },
      env
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  });

  it('does not expose out-of-scope routes', async () => {
    const quickLogin = await app.request(
      '/api/v1/auth/quick-login',
      { method: 'POST' },
      env
    );
    const purchases = await app.request('/api/v1/purchases', undefined, env);

    expect(quickLogin.status).toBe(404);
    expect(purchases.status).toBe(404);
  });
});
