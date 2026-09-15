import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

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

describe('POST /api/v1/wallet/deposits', () => {
  async function createDeposit(body: unknown, authenticated = true): Promise<Response> {
    return app.request(
      '/api/v1/wallet/deposits',
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

  it('creates one deposit order without pre-read, checkout, or balance mutation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: 'deposit-order-001', balance: 99, bonus: 50 })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await createDeposit({ amountMinor: 1_000 });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      data: { id: 'deposit-order-001' },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/order/save'
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      plan_id: 0,
      period: 'deposit',
      deposit_amount: 1_000,
    });
  });

  it.each([
    ['missing', {}],
    ['zero', { amountMinor: 0 }],
    ['negative', { amountMinor: -1 }],
    ['fractional', { amountMinor: 1.5 }],
    ['string', { amountMinor: '1000' }],
    ['NaN', { amountMinor: Number.NaN }],
    ['Infinity', { amountMinor: Number.POSITIVE_INFINITY }],
    ['above signed INT', { amountMinor: 2_147_483_648 }],
    ['unknown field', { amountMinor: 1_000, balance: 0 }],
    ['upstream alias', { deposit_amount: 1_000 }],
  ])('rejects %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await createDeposit(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts signed INT max without copying the official business maximum', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: 'deposit-order-max' })
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await createDeposit({ amountMinor: 2_147_483_647 });
    expect(response.status).toBe(201);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      deposit_amount: 2_147_483_647,
    });
  });

  it('requires auth before reading the body', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/wallet/deposits',
      { method: 'POST', body: '{invalid' },
      env
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [
      'You have an unpaid or pending order, please try again later or cancel it',
      409,
      'WALLET_DEPOSIT_UNAVAILABLE',
    ],
    [
      '您有未付款或开通中的订单，请稍后再试或将其取消',
      409,
      'WALLET_DEPOSIT_UNAVAILABLE',
    ],
    [
      'Failed to create order, deposit amount must be greater than 0',
      422,
      'WALLET_DEPOSIT_AMOUNT_INVALID',
    ],
    [
      'Deposit amount too large, please contact the administrator',
      422,
      'WALLET_DEPOSIT_AMOUNT_INVALID',
    ],
    ['Failed to create order', 502, 'WALLET_DEPOSIT_CREATE_FAILED'],
    ['订单创建失败', 502, 'WALLET_DEPOSIT_CREATE_FAILED'],
    ['Unknown deposit state', 502, 'UPSTREAM_ERROR'],
  ] as const)('normalizes %s without leaking it', async (message, status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message, internal: 'private-deposit-state' }, 500)
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await createDeposit({ amountMinor: 1_000 });
    const text = await response.text();
    expect(response.status).toBe(status);
    expect(text).toContain(code);
    expect(text).not.toContain(message);
    expect(text).not.toContain('private-deposit-state');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('normalizes timeout without retry or recovery reads and logs no amount', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out deposit 137', 'TimeoutError'));
    vi.stubGlobal('fetch', fetcher);
    const response = await createDeposit({ amountMinor: 137 });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_TIMEOUT' },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('137');
    expect(logged).not.toContain('opaque-token');
    expect(logged).not.toContain('backend.example');
  });
});
