import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  FRONTEND_ORIGINS: 'https://client.example',
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

describe('GET /api/v1/wallet', () => {
  it.each([0, 12_345])(
    'returns only balanceMinor for upstream balance=%s',
    async (balance) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: {
            balance,
            email: 'private@example.com',
            uuid: 'private-uuid',
            telegram_id: 99,
            commission_balance: 456,
            commission_rate: 30,
            discount: 10,
            plan_id: 7,
            device_limit: 3,
            last_login_at: 1,
            created_at: 1,
            raw_user: 'must-not-leak',
          },
        })
      );
      vi.stubGlobal('fetch', fetcher);

      const response = await app.request(
        '/api/v1/wallet',
        {
          headers: {
            Authorization: 'Bearer opaque-token',
            'cf-ray': 'request-id',
          },
        },
        env
      );
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(JSON.parse(text)).toEqual({
        ok: true,
        data: { balanceMinor: balance },
        requestId: 'request-id',
      });
      expect(response.headers.get('cache-control')).toBe('no-store');
      for (const value of [
        'private@example.com',
        'private-uuid',
        'telegram',
        'commission',
        'discount',
        'plan_id',
        'device_limit',
        'last_login_at',
        'created_at',
        'raw_user',
      ]) {
        expect(text).not.toContain(value);
      }
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][0]).toBe(
        'https://backend.example/api/v1/user/info'
      );
    }
  );

  it('requires Authorization without calling upstream', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/wallet', undefined, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, '12345', null, undefined])(
    'fails closed on malformed balance %s',
    async (balance) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({ data: { balance } })
        )
      );
      const response = await app.request(
        '/api/v1/wallet',
        { headers: { Authorization: 'Bearer opaque-token' } },
        env
      );
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        error: { code: 'UPSTREAM_ERROR' },
      });
    }
  );

  it('normalizes auth failure and timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );
    let response = await app.request(
      '/api/v1/wallet',
      { headers: { Authorization: 'Bearer invalid-token' } },
      env
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_FAILED' } });

    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    response = await app.request(
      '/api/v1/wallet',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_TIMEOUT' },
    });
  });

  it('does not change the existing /me DTO', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: {
            email: 'user@example.com',
            expired_at: null,
            banned: 0,
            balance: 12_345,
          },
        })
      )
    );
    const response = await app.request(
      '/api/v1/me',
      { headers: { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' } },
      env
    );
    expect(await response.json()).toEqual({
      ok: true,
      data: { email: 'user@example.com', expiresAt: null, status: 'active' },
      requestId: 'request-id',
    });
  });

  it('does not log upstream user data or credentials', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>private wallet failure 12345</h1>', { status: 500 })
      )
    );
    await app.request(
      '/api/v1/wallet',
      { headers: { Authorization: 'Bearer sensitive-token' } },
      env
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('12345');
    expect(logged).not.toContain('sensitive-token');
    expect(logged).not.toContain('private wallet failure');
    expect(logged).not.toContain('backend.example');
  });
});
