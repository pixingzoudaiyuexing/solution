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

function authorization(): HeadersInit {
  return { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/referrals', () => {
  it('returns named stats and only shareable invite code fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          codes: [
            {
              id: 11,
              user_id: 99,
              code: 'AbCd1234',
              status: 0,
              pv: 3,
              created_at: 1704067200,
              updated_at: 1704153600,
            },
          ],
          stat: [10, 1200, 300, 30, 900],
        },
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/referrals',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        codes: [{ code: 'AbCd1234', createdAt: '2024-01-01T00:00:00.000Z' }],
        stats: {
          registeredUsers: 10,
          earnedCommissionMinor: 1200,
          pendingCommissionMinor: 300,
          commissionRatePercent: 30,
          availableCommissionMinor: 900,
        },
      },
      requestId: 'request-id',
    });
    const serialized = JSON.stringify(body);
    for (const field of ['user_id', 'invite_user_id', 'status', 'pv', 'trade_no']) {
      expect(serialized).not.toContain(field);
    }
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('requires shared authorization', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/referrals', undefined, env);
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes malformed data, auth failure, timeout, and hides upstream details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: { codes: [], stat: [0, 0, 0, 10] } })
      )
    );
    let response = await app.request(
      '/api/v1/referrals',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(502);

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'Session expired' }, 403))
    );
    response = await app.request(
      '/api/v1/referrals',
      { headers: { Authorization: 'Bearer invalid-token' } },
      env
    );
    expect(response.status).toBe(401);

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    response = await app.request(
      '/api/v1/referrals',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(504);

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>private referral failure</h1>', { status: 500 })
      )
    );
    await app.request(
      '/api/v1/referrals',
      { headers: { Authorization: 'Bearer sensitive-token' } },
      env
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('sensitive-token');
    expect(logged).not.toContain('private referral failure');
    expect(logged).not.toContain('backend.example');
  });
});

describe('POST /api/v1/referrals/codes', () => {
  it('keeps Public POST while making one official upstream GET', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: true }));
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/referrals/codes',
      { method: 'POST', headers: authorization() },
      env
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      data: { created: true },
      requestId: 'request-id',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/invite/save'
    );
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
    expect(fetcher.mock.calls[0][1]?.body).toBeUndefined();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('requires authorization before any upstream call', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/referrals/codes',
      { method: 'POST' },
      env
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'The maximum number of creations has been reached',
    '已达到创建数量上限',
  ])('normalizes exact creation limit without leaking it: %s', async (message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    const response = await app.request(
      '/api/v1/referrals/codes',
      { method: 'POST', headers: authorization() },
      env
    );
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(text).toContain('REFERRAL_CODE_LIMIT_REACHED');
    expect(text).not.toContain(message);
  });

  it('normalizes malformed success, unknown failure, and timeout', async () => {
    for (const upstream of [
      jsonResponse({ data: false }),
      jsonResponse({ message: 'Random generator unavailable' }, 500),
    ]) {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(upstream));
      const response = await app.request(
        '/api/v1/referrals/codes',
        { method: 'POST', headers: authorization() },
        env
      );
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
    }

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const timeout = await app.request(
      '/api/v1/referrals/codes',
      { method: 'POST', headers: authorization() },
      env
    );
    expect(timeout.status).toBe(504);
  });

  it('does not log an upstream-generated code, token, or internal failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            data: false,
            code: 'SensitiveInviteCode',
            message: 'private database failure',
          },
          500
        )
      )
    );
    await app.request(
      '/api/v1/referrals/codes',
      { method: 'POST', headers: { Authorization: 'Bearer sensitive-token' } },
      env
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('SensitiveInviteCode');
    expect(logged).not.toContain('sensitive-token');
    expect(logged).not.toContain('private database failure');
    expect(logged).not.toContain('backend.example');
  });
});

describe('GET /api/v1/referrals/commissions', () => {
  it('uses default pagination and strips CommissionLog id and trade_no', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 31,
            trade_no: 'other-users-private-order',
            order_amount: 1000,
            get_amount: 100,
            created_at: 1704067200,
          },
        ],
        total: 1,
      })
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/referrals/commissions',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        items: [
          {
            orderAmountMinor: 1000,
            commissionAmountMinor: 100,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      },
      requestId: 'request-id',
    });
    expect(JSON.stringify(body)).not.toContain('other-users-private-order');
    expect(JSON.stringify(body)).not.toContain('trade_no');
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/invite/details?current=1&page_size=20'
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['custom page', '?page=2&pageSize=10', 'current=2&page_size=10'],
    ['max page size', '?page=1&pageSize=100', 'current=1&page_size=100'],
  ])('maps %s', async (_case, query, expected) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: [], total: 0 })
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      `/api/v1/referrals/commissions${query}`,
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toContain(expected);
  });

  it.each([
    '?page=0',
    '?page=-1',
    '?page=1.5',
    '?page=abc',
    '?page=2147483648',
    '?pageSize=9',
    '?pageSize=101',
    '?pageSize=10.5',
    '?pageSize=abc',
    '?page=1&page=2',
    '?unknown=1',
  ])('rejects invalid pagination %s before upstream', async (query) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      `/api/v1/referrals/commissions${query}`,
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires authorization before pagination validation', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/referrals/commissions?page=bad',
      undefined,
      env
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes malformed history and timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [{ order_amount: 1.5, get_amount: 1, created_at: 1 }],
          total: 1,
        })
      )
    );
    let response = await app.request(
      '/api/v1/referrals/commissions',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(502);

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    response = await app.request(
      '/api/v1/referrals/commissions',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(504);
  });
});
