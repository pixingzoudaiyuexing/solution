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

describe('POST /api/v1/referrals/commissions/transfer', () => {
  async function transfer(body: unknown, authenticated = true): Promise<Response> {
    return app.request(
      '/api/v1/referrals/commissions/transfer',
      {
        method: 'POST',
        headers: {
          ...(authenticated ? { Authorization: 'Bearer opaque-token' } : {}),
          'Content-Type': 'application/json',
          'cf-ray': 'request-id',
        },
        body: JSON.stringify(body),
      },
      env
    );
  }

  it('transfers through one upstream call and returns only transferred=true', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: true, order_id: 7, balance: 999 })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await transfer({ amountMinor: 137 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { transferred: true },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/transfer'
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      transfer_amount: 137,
    });
  });

  it.each([
    ['missing amount', {}],
    ['zero', { amountMinor: 0 }],
    ['negative', { amountMinor: -1 }],
    ['fractional', { amountMinor: 1.5 }],
    ['string', { amountMinor: '100' }],
    ['above INT', { amountMinor: 2_147_483_648 }],
    ['unknown field', { amountMinor: 1, balance: 1 }],
    ['upstream alias', { transfer_amount: 1 }],
  ])('rejects %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await transfer(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts the INT maximum unchanged', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: true })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await transfer({ amountMinor: 2_147_483_647 });

    expect(response.status).toBe(200);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      transfer_amount: 2_147_483_647,
    });
  });

  it('requires Authorization before reading the body', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/referrals/commissions/transfer',
      { method: 'POST', body: '{invalid' },
      env
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps invalid upstream Authorization to AUTH_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );
    const response = await transfer({ amountMinor: 1 });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_FAILED' } });
  });

  it.each([
    ['Insufficient commission balance', 409, 'INSUFFICIENT_COMMISSION_BALANCE'],
    ['推广佣金余额不足', 409, 'INSUFFICIENT_COMMISSION_BALANCE'],
    ['Transfer failed', 502, 'COMMISSION_TRANSFER_FAILED'],
    ['划转失败', 502, 'COMMISSION_TRANSFER_FAILED'],
  ] as const)('normalizes %s without leaking it', async (message, status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    const response = await transfer({ amountMinor: 1 });
    const text = await response.text();
    expect(response.status).toBe(status);
    expect(text).toContain(code);
    expect(text).not.toContain(message);
  });

  it('normalizes unknown failure and timeout without retry', async () => {
    const unknownFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: 'Unexpected state' }, 500)
    );
    vi.stubGlobal('fetch', unknownFetcher);
    let response = await transfer({ amountMinor: 1 });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
    expect(unknownFetcher).toHaveBeenCalledOnce();

    const timeoutFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', timeoutFetcher);
    response = await transfer({ amountMinor: 1 });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: { code: 'UPSTREAM_TIMEOUT' } });
    expect(timeoutFetcher).toHaveBeenCalledOnce();
  });

  it('does not log amounts, token, or raw upstream details', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>private transfer failure 137</h1>', { status: 500 })
      )
    );
    await transfer({ amountMinor: 137 });
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('137');
    expect(logged).not.toContain('opaque-token');
    expect(logged).not.toContain('private transfer failure');
    expect(logged).not.toContain('backend.example');
  });
});

describe('GET /api/v1/referrals/withdrawal-options', () => {
  it('returns only mapped options in upstream order with no-store', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          withdraw_close: 0,
          withdraw_methods: ['支付宝', 'USDT', 'Paypal'],
          stripe_pk: 'must-not-leak',
          telegram: { token: 'must-not-leak' },
          commission_distribution: { enabled: true },
        },
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/referrals/withdrawal-options',
      { headers: authorization() },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { enabled: true, methods: ['支付宝', 'USDT', 'Paypal'] },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns disabled with an empty methods array unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: { withdraw_close: 1, withdraw_methods: [] } })
      )
    );

    const response = await app.request(
      '/api/v1/referrals/withdrawal-options',
      { headers: authorization() },
      env
    );
    expect(await response.json()).toMatchObject({
      data: { enabled: false, methods: [] },
    });
  });

  it('requires authentication before upstream', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/referrals/withdrawal-options',
      undefined,
      env
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes malformed options, auth failure, and timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: { withdraw_close: '0', withdraw_methods: [] } })
      )
    );
    let response = await app.request(
      '/api/v1/referrals/withdrawal-options',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(502);

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );
    response = await app.request(
      '/api/v1/referrals/withdrawal-options',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(401);

    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    response = await app.request(
      '/api/v1/referrals/withdrawal-options',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(504);
  });
});

describe('POST /api/v1/referrals/withdrawal-requests', () => {
  const sensitiveAccount = 'SUPER_SECRET_WITHDRAWAL_ACCOUNT_123';

  async function requestWithdrawal(
    body: unknown,
    authenticated = true
  ): Promise<Response> {
    return app.request(
      '/api/v1/referrals/withdrawal-requests',
      {
        method: 'POST',
        headers: {
          ...(authenticated ? { Authorization: 'Bearer opaque-token' } : {}),
          'Content-Type': 'application/json',
          'cf-ray': 'request-id',
        },
        body: JSON.stringify(body),
      },
      env
    );
  }

  it('creates one request and returns only requested=true', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: true, ticket_id: 7, account: sensitiveAccount })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await requestWithdrawal({
      method: 'USDT',
      account: sensitiveAccount,
    });
    const text = await response.text();

    expect(response.status).toBe(201);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      data: { requested: true },
      requestId: 'request-id',
    });
    expect(text).not.toContain(sensitiveAccount);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/ticket/withdraw'
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      withdraw_method: 'USDT',
      withdraw_account: sensitiveAccount,
    });
  });

  it.each([
    ['missing method', { account: sensitiveAccount }],
    ['empty method', { method: '', account: sensitiveAccount }],
    ['oversized method', { method: 'm'.repeat(256), account: sensitiveAccount }],
    ['missing account', { method: 'USDT' }],
    ['empty account', { method: 'USDT', account: '' }],
    ['oversized account', { method: 'USDT', account: 'a'.repeat(1025) }],
    ['unknown field', { method: 'USDT', account: sensitiveAccount, extra: true }],
    [
      'upstream aliases',
      { withdraw_method: 'USDT', withdraw_account: sensitiveAccount },
    ],
    ['amount', { method: 'USDT', account: sensitiveAccount, amount: 1 }],
    ['amountMinor', { method: 'USDT', account: sensitiveAccount, amountMinor: 1 }],
  ])('rejects %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await requestWithdrawal(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires authentication before reading the body', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/referrals/withdrawal-requests',
      { method: 'POST', body: '{invalid' },
      env
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['user.ticket.withdraw.not_support_withdraw', 409, 'WITHDRAWAL_DISABLED'],
    ['Unsupported withdrawal method', 422, 'WITHDRAWAL_METHOD_UNSUPPORTED'],
    ['不支持的提现方式', 422, 'WITHDRAWAL_METHOD_UNSUPPORTED'],
    [
      'The current required minimum withdrawal commission is 100',
      409,
      'WITHDRAWAL_MINIMUM_NOT_MET',
    ],
    ['当前系统要求的最少提现佣金为：¥100CNY', 409, 'WITHDRAWAL_MINIMUM_NOT_MET'],
    ['Failed to open ticket', 502, 'WITHDRAWAL_REQUEST_FAILED'],
    ['工单创建失败', 502, 'WITHDRAWAL_REQUEST_FAILED'],
  ] as const)('normalizes %s without leaking it', async (message, status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message, account: sensitiveAccount }, 500)
      )
    );
    const response = await requestWithdrawal({
      method: 'USDT',
      account: sensitiveAccount,
    });
    const text = await response.text();
    expect(response.status).toBe(status);
    expect(text).toContain(code);
    expect(text).not.toContain(message);
    expect(text).not.toContain(sensitiveAccount);
  });

  it.each([{ data: false }, { data: null }, {}, { data: 'true' }, []])(
    'fails closed on malformed success %#',
    async (payload) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
      );
      const response = await requestWithdrawal({
        method: 'USDT',
        account: sensitiveAccount,
      });
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        error: { code: 'UPSTREAM_ERROR' },
      });
    }
  );

  it('normalizes unknown failure and timeout without retry or sensitive logs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unknownFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: `SQL failure ${sensitiveAccount}` }, 500)
    );
    vi.stubGlobal('fetch', unknownFetcher);
    let response = await requestWithdrawal({
      method: 'USDT',
      account: sensitiveAccount,
    });
    let text = await response.text();
    expect(response.status).toBe(502);
    expect(text).toContain('UPSTREAM_ERROR');
    expect(text).not.toContain(sensitiveAccount);
    expect(unknownFetcher).toHaveBeenCalledOnce();

    const timeoutFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', timeoutFetcher);
    response = await requestWithdrawal({
      method: 'USDT',
      account: sensitiveAccount,
    });
    text = await response.text();
    expect(response.status).toBe(504);
    expect(text).toContain('UPSTREAM_TIMEOUT');
    expect(text).not.toContain(sensitiveAccount);
    expect(timeoutFetcher).toHaveBeenCalledOnce();

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(sensitiveAccount);
    expect(logged).not.toContain('opaque-token');
    expect(logged).not.toContain('SQL failure');
    expect(logged).not.toContain('backend.example');
  });
});
