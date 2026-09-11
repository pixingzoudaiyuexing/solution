import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardOrderCreateError,
  V2BoardOrderNotFoundError,
  V2BoardOrderQueryError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardOrdersAdapter } from '../src/adapters/v2board/orders';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardOrdersAdapter {
  return new V2BoardOrdersAdapter(
    new V2BoardClient(
      { baseUrl: 'https://private.example/api/v1/' },
      fetcher
    )
  );
}

function upstreamOrder(status: number, suffix: string): Record<string, unknown> {
  return {
    trade_no: `order-${suffix}`,
    status,
    total_amount: 1099,
    created_at: 1704067200,
    updated_at: suffix === 'adjusted' ? null : 1704153600,
    plan_id: 7,
    payment_id: 3,
    callback_no: 'private-callback',
    commission_balance: 200,
    user: { uuid: 'private-user-uuid' },
    payment: { config: 'private-payment-metadata' },
  };
}

describe('V2BoardOrdersAdapter', () => {
  it('returns an empty list when the user has no orders', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }))
    );

    await expect(adapter.orders('opaque-token')).resolves.toEqual([]);
  });

  it('maps an official commission transfer deposit order without changing the Order contract', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [
            {
              trade_no: 'deposit-order-001',
              plan_id: 0,
              period: 'deposit',
              status: 3,
              total_amount: 0,
              surplus_amount: 1,
              callback_no: 'Commission transfer',
              created_at: 1704067200,
              updated_at: 1704153600,
            },
          ],
        })
      )
    );

    await expect(adapter.orders('opaque-token')).resolves.toEqual([
      {
        id: 'deposit-order-001',
        status: 'completed',
        amountMinor: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        expiresAt: null,
      },
    ]);
  });

  it('maps all V2Board statuses and strips internal fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          upstreamOrder(0, 'pending'),
          upstreamOrder(1, 'processing'),
          upstreamOrder(2, 'cancelled'),
          upstreamOrder(3, 'completed'),
          upstreamOrder(4, 'adjusted'),
        ],
        internal_meta: 'must-not-leak',
      })
    );
    const adapter = createAdapter(fetcher);

    await expect(adapter.orders('opaque-token')).resolves.toEqual([
      {
        id: 'order-pending',
        status: 'pending',
        amountMinor: 1099,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        expiresAt: null,
      },
      {
        id: 'order-processing',
        status: 'processing',
        amountMinor: 1099,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        expiresAt: null,
      },
      {
        id: 'order-cancelled',
        status: 'cancelled',
        amountMinor: 1099,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        expiresAt: null,
      },
      {
        id: 'order-completed',
        status: 'completed',
        amountMinor: 1099,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        expiresAt: null,
      },
      {
        id: 'order-adjusted',
        status: 'adjusted',
        amountMinor: 1099,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: null,
        expiresAt: null,
      },
    ]);

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://private.example/api/v1/user/order/fetch');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it('maps a JSON upstream error to an order query failure', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Database query failed' }, 500)
      )
    );

    await expect(adapter.orders('opaque-token')).rejects.toBeInstanceOf(
      V2BoardOrderQueryError
    );
  });

  it('treats a non-object JSON error as an unknown upstream failure', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse('Database query failed', 500)
      )
    );

    await expect(adapter.orders('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes an HTML upstream error', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>Laravel exception</h1>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    );

    await expect(adapter.orders('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes invalid JSON', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{invalid-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    await expect(adapter.orders('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('preserves the shared timeout error', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('The operation timed out', 'TimeoutError')
      )
    );

    await expect(adapter.orders('opaque-token')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });

  it.each([
    ['fractional amount', { ...upstreamOrder(0, 'bad-amount'), total_amount: 10.99 }],
    ['unknown status', upstreamOrder(9, 'bad-status')],
    ['string expiry', { ...upstreamOrder(0, 'string-expiry'), expires_at: '1704074400' }],
    ['negative expiry', { ...upstreamOrder(0, 'negative-expiry'), expires_at: -1 }],
    [
      'out-of-range expiry',
      { ...upstreamOrder(0, 'large-expiry'), expires_at: 253402300800 },
    ],
  ])('fails closed on %s', async (_case, order) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [order] }))
    );

    await expect(adapter.orders('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('maps a future compatible authoritative expiry when provided', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [
            {
              ...upstreamOrder(0, 'with-expiry'),
              expires_at: 1704074400,
            },
          ],
        })
      )
    );

    await expect(adapter.orders('opaque-token')).resolves.toEqual([
      {
        id: 'order-with-expiry',
        status: 'pending',
        amountMinor: 1099,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        expiresAt: '2024-01-01T02:00:00.000Z',
      },
    ]);
  });

  it('accepts an explicit null expiry without calculating a fallback', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [{ ...upstreamOrder(0, 'null-expiry'), expires_at: null }],
        })
      )
    );

    await expect(adapter.orders('opaque-token')).resolves.toMatchObject([
      { id: 'order-null-expiry', expiresAt: null },
    ]);
  });

  it.each([
    ['month', 'month_price'],
    ['quarter', 'quarter_price'],
    ['halfYear', 'half_year_price'],
    ['year', 'year_price'],
    ['twoYears', 'two_year_price'],
    ['threeYears', 'three_year_price'],
    ['oneTime', 'onetime_price'],
  ] as const)('maps billing period %s to %s', async (billingPeriod, period) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: 'order-created', ignored: 'private' })
    );
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.createOrder('opaque-token', {
        productId: '7',
        billingPeriod,
      })
    ).resolves.toEqual({ id: 'order-created' });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://private.example/api/v1/user/order/save');
    expect(init?.redirect).toBe('manual');
    expect(JSON.parse(String(init?.body))).toEqual({
      plan_id: 7,
      period,
    });
  });

  it('maps a JSON create rejection without retaining its details', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Current product is sold out' }, 500)
      )
    );

    await expect(
      adapter.createOrder('opaque-token', {
        productId: '7',
        billingPeriod: 'month',
      })
    ).rejects.toBeInstanceOf(V2BoardOrderCreateError);
  });

  it('fails closed on a malformed create success response', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: { trade_no: 'unexpected-shape' } })
      )
    );

    await expect(
      adapter.createOrder('opaque-token', {
        productId: '7',
        billingPeriod: 'month',
      })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('maps order detail to the same public DTO', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: upstreamOrder(3, 'detail') })
    );
    const adapter = createAdapter(fetcher);

    await expect(adapter.order('opaque-token', 'order-detail')).resolves.toEqual({
      id: 'order-detail',
      status: 'completed',
      amountMinor: 1099,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      expiresAt: null,
    });

    expect(fetcher.mock.calls[0][0]).toBe(
      'https://private.example/api/v1/user/order/detail?trade_no=order-detail'
    );
  });

  it.each([
    'Order does not exist or has been paid',
    '订单不存在或已支付',
  ])('maps a known missing-order response: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    await expect(adapter.order('opaque-token', 'missing-order')).rejects.toBeInstanceOf(
      V2BoardOrderNotFoundError
    );
  });

  it('fails closed on a malformed detail success response', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: { trade_no: 'order-detail' } })
      )
    );

    await expect(adapter.order('opaque-token', 'order-detail')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });
});
