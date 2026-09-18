import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

const env = {
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
  V2BOARD_CONTROL_AUTH_DATA: 'AUTH_DATA_SENTINEL',
  V2BOARD_CONTROL_ADMIN_PREFIX: 'secure-admin_123',
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

describe('Registry Control Plane is not reachable from data-plane routes', () => {
  it('does not register Registry or Control Plane HTTP routes', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    for (const path of [
      '/api/v1/registry',
      '/api/v1/registry/raw',
      '/api/v1/control-plane',
      '/api/v1/registry/refresh',
    ]) {
      const response = await app.request(
        path,
        { headers: { Authorization: 'Bearer browser-token' } },
        env
      );
      expect(response.status).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never lets malicious public input select Admin operation/path/id/config', async () => {
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

    const requests = [
      new Request(
        'https://gateway.example/api/v1/notices?adminPrefix=secure-admin_123&knowledgeId=9',
        { headers: { Authorization: 'Bearer browser-token' } }
      ),
      new Request('https://gateway.example/api/v1/me?operation=knowledge/fetch', {
        headers: {
          Authorization: 'Bearer browser-token',
          'X-Admin-Prefix': 'secure-admin_123',
          'X-Control-Auth': 'AUTH_DATA_SENTINEL',
        },
      }),
      new Request('https://gateway.example/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'password123',
          knowledgeId: 9,
          configKey: 'V2BOARD_CONTROL_AUTH_DATA',
          couponId: 3,
        }),
      }),
    ];

    for (const request of requests) {
      await app.fetch(request, env);
    }

    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).not.toContain('secure-admin_123');
      expect(String(url)).not.toContain('/knowledge/');
      expect(new Headers(init?.headers).get('authorization')).not.toBe(
        'AUTH_DATA_SENTINEL'
      );
    }
  });
});
