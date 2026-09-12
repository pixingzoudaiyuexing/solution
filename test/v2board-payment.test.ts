import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
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

const signedTarget =
  'https://pay.example/submit.php?money=10.00&name=order-001&notify_url=https%3A%2F%2Fprivate.example%2Fapi%2Fv1%2Fguest%2Fpayment%2Fnotify%2FEPay%2F123e4567-e89b-12d3-a456-426614174000&return_url=https%3A%2F%2Fprivate.example%2F%23%2Forder%2Forder-001&out_trade_no=order-001&pid=1000&type=alipay&sign=abc123&sign_type=MD5';

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

  it('preserves an EPay signed redirect containing the hidden callback host', async () => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ type: 1, data: signedTarget }))
    );

    await expect(
      adapter.checkout('opaque-token', 'order-001', { paymentMethodId: '3' })
    ).resolves.toEqual({ type: 'redirect', target: signedTarget });
  });

  it.each([
    'https://private.example/payment',
    'http://pay.example/checkout',
    'https://localhost/checkout',
    'https://pay.example/checkout?foo=https%3A%2F%2Fprivate.example%2Fsecret',
    'https://pay.example/checkout?notify_url=https%3A%2F%2Fprivate.example%2Fsecret',
    'https://pay.example/checkout?return_url=https%3A%2F%2Fprivate.example%2Fsecret',
  ])('still rejects unsafe checkout redirect %s', async (target) => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ type: 1, data: target }))
    );

    await expect(
      adapter.checkout('opaque-token', 'order-001', { paymentMethodId: '3' })
    ).rejects.toBeInstanceOf(V2BoardPaymentCreateError);
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
