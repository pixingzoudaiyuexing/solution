import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

const env = {
  V2BOARD_BASE_URL: 'https://private.example/api/v1/',
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

describe('GET /api/v1/orders', () => {
  it('returns authenticated orders through the public DTO', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            trade_no: 'order-001',
            status: 0,
            total_amount: 1099,
            created_at: 1704067200,
            updated_at: 1704153600,
            plan_id: 7,
            payment_id: 3,
            callback_no: 'private-callback',
            commission_balance: 200,
            user: { uuid: 'private-user-uuid' },
            payment: { config: 'private-payment-metadata' },
          },
        ],
      })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders',
      {
        headers: {
          Authorization: 'Bearer opaque-token',
          'cf-ray': 'request-id',
        },
      },
      env
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: [
        {
          id: 'order-001',
          status: 'pending',
          amountMinor: 1099,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          expiresAt: null,
        },
      ],
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('private-callback');
    expect(serialized).not.toContain('private-user-uuid');
    expect(serialized).not.toContain('private-payment-metadata');
    expect(serialized).not.toContain('opaque-token');

    const [url, init] = upstreamFetch.mock.calls[0];
    expect(url).toBe('https://private.example/api/v1/user/order/fetch');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it('requires the shared Authorization middleware', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders',
      { headers: { 'cf-ray': 'request-id' } },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('maps an invalid upstream token to AUTH_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );

    const response = await app.request(
      '/api/v1/orders',
      {
        headers: {
          Authorization: 'Bearer invalid-token',
          'cf-ray': 'request-id',
        },
      },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_FAILED' },
    });
  });

  it('maps a JSON order query failure without exposing its error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'SQL query failed' }, 500)
      )
    );

    const response = await app.request(
      '/api/v1/orders',
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
    expect(body).toContain('ORDER_QUERY_FAILED');
    expect(body).not.toContain('SQL query failed');
  });

  it('maps an upstream timeout to UPSTREAM_TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('The operation timed out', 'TimeoutError')
      )
    );

    const response = await app.request(
      '/api/v1/orders',
      {
        headers: {
          Authorization: 'Bearer opaque-token',
          'cf-ray': 'request-id',
        },
      },
      env
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_TIMEOUT' },
    });
  });

});

describe('POST /api/v1/orders', () => {
  it('creates an order from the public product and billing period', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: 'order-002', internal: 'must-not-leak' })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer opaque-token',
          'Content-Type': 'application/json',
          'cf-ray': 'request-id',
        },
        body: JSON.stringify({
          productId: '7',
          billingPeriod: 'month',
        }),
      },
      env
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      data: { id: 'order-002' },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');

    const [url, init] = upstreamFetch.mock.calls[0];
    expect(url).toBe('https://private.example/api/v1/user/order/save');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
    expect(JSON.parse(String(init?.body))).toEqual({
      plan_id: 7,
      period: 'month_price',
    });
  });

  it('applies a trimmed promotion through one authoritative order/save call', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: 'order-promoted', discount_amount: 500 })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer opaque-token',
          'Content-Type': 'application/json',
          'cf-ray': 'request-id',
        },
        body: JSON.stringify({
          productId: '7',
          billingPeriod: 'month',
          promotionCode: '  PROMO123  ',
        }),
      },
      env
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      data: { id: 'order-promoted' },
      requestId: 'request-id',
    });
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(upstreamFetch.mock.calls[0][0]).toBe(
      'https://private.example/api/v1/user/order/save'
    );
    expect(JSON.parse(String(upstreamFetch.mock.calls[0][1]?.body))).toEqual({
      plan_id: 7,
      period: 'month_price',
      coupon_code: 'PROMO123',
    });
  });

  it.each([
    ['missing productId', { billingPeriod: 'month' }],
    ['invalid productId', { productId: 'not-an-id', billingPeriod: 'month' }],
    ['zero productId', { productId: '0', billingPeriod: 'month' }],
    ['missing billingPeriod', { productId: '7' }],
    ['reset period', { productId: '7', billingPeriod: 'reset' }],
    [
      'extra payment field',
      { productId: '7', billingPeriod: 'month', paymentMethod: 'private' },
    ],
    ['empty promotion', { productId: '7', billingPeriod: 'month', promotionCode: '' }],
    [
      'whitespace promotion',
      { productId: '7', billingPeriod: 'month', promotionCode: '   ' },
    ],
    [
      'long promotion',
      { productId: '7', billingPeriod: 'month', promotionCode: 'x'.repeat(256) },
    ],
    [
      'upstream coupon_code',
      { productId: '7', billingPeriod: 'month', coupon_code: 'PROMO123' },
    ],
    [
      'couponCode alias',
      { productId: '7', billingPeriod: 'month', couponCode: 'PROMO123' },
    ],
    ['code alias', { productId: '7', billingPeriod: 'month', code: 'PROMO123' }],
    ['discount field', { productId: '7', billingPeriod: 'month', discount: 1 }],
    ['balance field', { productId: '7', billingPeriod: 'month', balance: 1 }],
    ['amount field', { productId: '7', billingPeriod: 'month', amount: 1 }],
    ['price field', { productId: '7', billingPeriod: 'month', price: 1 }],
    [
      'totalAmount field',
      { productId: '7', billingPeriod: 'month', totalAmount: 1 },
    ],
  ])('rejects %s without contacting V2Board', async (_case, body) => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer opaque-token',
          'Content-Type': 'application/json',
          'cf-ray': 'request-id',
        },
        body: JSON.stringify(body),
      },
      env
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('requires authentication before parsing the request body', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-ray': 'request-id',
        },
        body: JSON.stringify({ productId: '7', billingPeriod: 'month' }),
      },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('maps an invalid upstream token to AUTH_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );

    const response = await app.request(
      '/api/v1/orders',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer invalid-token',
          'Content-Type': 'application/json',
          'cf-ray': 'request-id',
        },
        body: JSON.stringify({ productId: '7', billingPeriod: 'month' }),
      },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_FAILED' },
    });
  });

  it('maps an upstream business rejection to ORDER_CREATE_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Current product is sold out' }, 500)
      )
    );

    const response = await app.request(
      '/api/v1/orders',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer opaque-token',
          'Content-Type': 'application/json',
          'cf-ray': 'request-id',
        },
        body: JSON.stringify({ productId: '7', billingPeriod: 'month' }),
      },
      env
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('ORDER_CREATE_FAILED');
    expect(body).not.toContain('Current product is sold out');
  });

  it.each([
    'Invalid coupon',
    '优惠券无效',
    'This coupon is no longer available',
    'This coupon has not yet started',
    'This coupon has expired',
    'The coupon code cannot be used for this subscription',
    'The coupon code cannot be used for this period',
    'The coupon can only be used 2 per person',
    '该优惠券每人只能用 2 次',
  ])('maps authoritative coupon rejection to PROMOTION_INVALID: %s', async (message) => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message, coupon: 'private-coupon-model' }, 500)
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer opaque-token',
          'Content-Type': 'application/json',
          'cf-ray': 'request-id',
        },
        body: JSON.stringify({
          productId: '7',
          billingPeriod: 'month',
          promotionCode: 'PROMO123',
        }),
      },
      env
    );
    const text = await response.text();

    expect(response.status).toBe(422);
    expect(text).toContain('PROMOTION_INVALID');
    expect(text).not.toContain(message);
    expect(text).not.toContain('private-coupon-model');
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it.each(['Coupon failed', '优惠券使用失败'])(
    'keeps operational %s as ORDER_CREATE_FAILED',
    async (message) => {
      const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message }, 500)
      );
      vi.stubGlobal('fetch', upstreamFetch);

      const response = await app.request(
        '/api/v1/orders',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer opaque-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            productId: '7',
            billingPeriod: 'month',
            promotionCode: 'PROMO123',
          }),
        },
        env
      );
      const text = await response.text();
      expect(response.status).toBe(502);
      expect(text).toContain('ORDER_CREATE_FAILED');
      expect(text).not.toContain(message);
      expect(upstreamFetch).toHaveBeenCalledOnce();
    }
  );

  it('maps an upstream timeout without retrying order creation', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException('The operation timed out', 'TimeoutError')
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer opaque-token',
          'Content-Type': 'application/json',
          'cf-ray': 'request-id',
        },
        body: JSON.stringify({ productId: '7', billingPeriod: 'month' }),
      },
      env
    );

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_TIMEOUT' },
    });
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it('does not log an order payload, token, or upstream error details', async () => {
    const token = 'sensitive-order-token';
    const promotionCode = 'SENSITIVE-PROMOTION-CODE';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: {
            trade_no: 'order-private',
            payment: { config: 'sensitive-payment-config' },
          },
        })
      )
    );

    const response = await app.request(
      '/api/v1/orders',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          productId: '7',
          billingPeriod: 'month',
          promotionCode,
        }),
      },
      env
    );

    expect(response.status).toBe(502);
    expect(error).toHaveBeenCalledOnce();
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(promotionCode);
    expect(logged).not.toContain('order-private');
    expect(logged).not.toContain('sensitive-payment-config');
  });
});

describe('GET /api/v1/orders/:id', () => {
  it('returns one order through the public DTO', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          trade_no: 'order-003',
          status: 3,
          total_amount: 2599,
          created_at: 1704067200,
          updated_at: null,
          plan: { group_id: 2, content: '<b>private</b>' },
          payment_id: 3,
          callback_no: 'private-callback',
          surplus_order_ids: [1, 2],
        },
      })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders/order-003',
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
        id: 'order-003',
        status: 'completed',
        amountMinor: 2599,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: null,
        expiresAt: null,
      },
      requestId: 'request-id',
    });

    const [url, init] = upstreamFetch.mock.calls[0];
    expect(url).toBe(
      'https://private.example/api/v1/user/order/detail?trade_no=order-003'
    );
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it('maps a missing order to ORDER_NOT_FOUND', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Order does not exist or has been paid' }, 500)
      )
    );

    const response = await app.request(
      '/api/v1/orders/missing-order',
      {
        headers: {
          Authorization: 'Bearer opaque-token',
          'cf-ray': 'request-id',
        },
      },
      env
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'ORDER_NOT_FOUND' },
    });
  });

  it('maps an invalid upstream token to AUTH_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );

    const response = await app.request(
      '/api/v1/orders/order-003',
      {
        headers: {
          Authorization: 'Bearer invalid-token',
          'cf-ray': 'request-id',
        },
      },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_FAILED' },
    });
  });

  it('rejects an invalid order id without contacting V2Board', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders/invalid%20id',
      {
        headers: {
          Authorization: 'Bearer opaque-token',
          'cf-ray': 'request-id',
        },
      },
      env
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/api/v1/orders/order-003/payment'],
    ['POST', '/api/v1/payment/callback'],
  ])('does not expose payment route %s %s', async (method, path) => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      path,
      { method, headers: { Authorization: 'Bearer opaque-token' } },
      env
    );

    expect(response.status).toBe(404);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
