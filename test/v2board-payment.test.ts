import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardOrderExpiredError,
  V2BoardPaymentCreateError,
  V2BoardPaymentMethodUnavailableError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardPaymentAdapter } from '../src/adapters/v2board/payment';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardPaymentAdapter {
  const hiddenOrigin = 'https://private.example/api/v1/';
  return new V2BoardPaymentAdapter(
    new V2BoardClient({ baseUrl: hiddenOrigin }, fetcher),
    hiddenOrigin
  );
}

describe('V2BoardPaymentAdapter', () => {
  it('maps payment methods without exposing plugin or merchant fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 3,
            name: '支付宝',
            icon: 'https://cdn.example/alipay.png',
            handling_fee_fixed: 25,
            handling_fee_percent: '0.50',
            payment: 'EPayQrcode',
            uuid: 'private-uuid',
            config: { key: 'merchant-key' },
          },
        ],
      })
    );

    await expect(createAdapter(fetcher).paymentMethods('opaque-token')).resolves.toEqual([
      {
        id: '3',
        name: '支付宝',
        icon: 'https://cdn.example/alipay.png',
        fee: { fixedMinor: 25, percent: 0.5 },
      },
    ]);

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://private.example/api/v1/user/order/getPaymentMethod'
    );
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it.each([
    [-1, true, { type: 'finished' }],
    [0, 'weixin://wxpay/qr', { type: 'qrcode', data: 'weixin://wxpay/qr' }],
    [
      1,
      'https://pay.example/checkout',
      { type: 'redirect', target: 'https://pay.example/checkout' },
    ],
    [2, true, { type: 'finished' }],
  ] as const)('maps checkout type %s', async (type, data, expected) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ type, data, ignored: 'private' }));
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.checkout(
        'opaque-token',
        'order-001',
        { paymentMethodId: '3' },
        {
          trustedOrigin: 'https://client.example',
          trustedUserAgent: 'Mozilla/5.0 (iPhone; Mobile)',
        }
      )
    ).resolves.toEqual(expected);

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://private.example/api/v1/user/order/checkout');
    expect(init?.redirect).toBe('manual');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('opaque-token');
    expect(headers.get('origin')).toBe('https://client.example');
    expect(headers.get('user-agent')).toBe('Mozilla/5.0 (iPhone; Mobile)');
    expect(JSON.parse(String(init?.body))).toEqual({
      trade_no: 'order-001',
      method: 3,
    });
  });

  it.each([
    { type: -1, data: false },
    { type: 2, data: false },
    { type: 3, data: 'unknown' },
    { type: 0, data: 'bad\npayload' },
    { type: 1, data: 'javascript:alert(1)' },
  ])('fails closed on malformed checkout response %#', async (payload) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );

    await expect(
      adapter.checkout('opaque-token', 'order-001', { paymentMethodId: '3' })
    ).rejects.toBeInstanceOf(V2BoardPaymentCreateError);
  });

  it('maps a known unavailable method response', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Payment method is not available' }, 500)
      )
    );

    await expect(
      adapter.checkout('opaque-token', 'order-001', { paymentMethodId: '3' })
    ).rejects.toBeInstanceOf(V2BoardPaymentMethodUnavailableError);
  });

  it('maps only the exact normalized order expiry response', async () => {
    const expiredAdapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: '  Order has expired  ' }, 500)
      )
    );
    const unrelatedAdapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Provider session expired' }, 500)
      )
    );

    await expect(
      expiredAdapter.checkout('opaque-token', 'order-001', {
        paymentMethodId: '3',
      })
    ).rejects.toBeInstanceOf(V2BoardOrderExpiredError);
    await expect(
      unrelatedAdapter.checkout('opaque-token', 'order-001', {
        paymentMethodId: '3',
      })
    ).rejects.toBeInstanceOf(V2BoardPaymentCreateError);
  });

  it('normalizes HTML and invalid JSON responses', async () => {
    for (const response of [
      new Response('<h1>Laravel error</h1>', { status: 500 }),
      new Response('{invalid', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]) {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(response)
      );
      await expect(
        adapter.checkout('opaque-token', 'order-001', { paymentMethodId: '3' })
      ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    }
  });

  it('preserves the shared timeout error', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('The operation timed out', 'TimeoutError')
      )
    );

    await expect(
      adapter.checkout('opaque-token', 'order-001', { paymentMethodId: '3' })
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });
});
