import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  V2BOARD_BASE_URL: 'https://private.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authorizedRequest(): Response | Promise<Response> {
  return app.request(
    '/api/v1/billing/methods',
    {
      headers: {
        Authorization: 'Bearer opaque-token',
        'cf-ray': 'request-id',
      },
    },
    env
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/billing/methods', () => {
  it('maps multiple enabled channels and strips internal payment fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [
            {
              id: 3,
              name: '支付宝',
              icon: 'https://cdn.example/alipay.png',
              handling_fee_fixed: 25,
              handling_fee_percent: '0.50',
              payment: 'EPayQrcode',
              uuid: 'private-payment-uuid',
              notify_domain: 'https://callback.internal.example',
              config: { pid: 'merchant-id', key: 'merchant-secret' },
            },
            {
              id: 4,
              name: '微信支付',
              icon: null,
              handling_fee_fixed: null,
              handling_fee_percent: null,
              payment: 'WechatPayNative',
            },
            {
              id: 5,
              name: 'Disabled channel',
              icon: null,
              handling_fee_fixed: 0,
              handling_fee_percent: 0,
              enable: 0,
            },
          ],
        })
      )
    );

    const response = await authorizedRequest();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: [
        {
          id: '3',
          name: '支付宝',
          icon: 'https://cdn.example/alipay.png',
          fee: { fixedMinor: 25, percent: 0.5 },
        },
        {
          id: '4',
          name: '微信支付',
          icon: null,
          fee: { fixedMinor: 0, percent: 0 },
        },
      ],
      requestId: 'request-id',
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('EPayQrcode');
    expect(serialized).not.toContain('private-payment-uuid');
    expect(serialized).not.toContain('callback.internal.example');
    expect(serialized).not.toContain('merchant-id');
    expect(serialized).not.toContain('merchant-secret');
  });

  it('returns an empty list when V2Board has no enabled channels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }))
    );

    const response = await authorizedRequest();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: [] });
  });

  it('drops an unsafe icon URL instead of exposing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [
            {
              id: 3,
              name: 'Unsafe icon',
              icon: 'javascript:alert(1)',
              handling_fee_fixed: 0,
              handling_fee_percent: 0,
            },
          ],
        })
      )
    );

    const response = await authorizedRequest();
    expect(await response.json()).toMatchObject({
      data: [{ id: '3', icon: null }],
    });
  });

  it('does not grant signed callback exceptions to payment icons', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [
            {
              id: 3,
              name: 'Unsafe embedded icon',
              icon: 'https://cdn.example/icon.png?notify_url=https%3A%2F%2Fprivate.example%2Fapi%2Fv1%2Fguest%2Fpayment%2Fnotify%2FEPay%2Fuuid',
              handling_fee_fixed: 0,
              handling_fee_percent: 0,
            },
          ],
        })
      )
    );

    const response = await authorizedRequest();

    expect(await response.json()).toMatchObject({
      data: [{ id: '3', icon: null }],
    });
  });

  it('fails closed on a malformed upstream method', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: [{ id: 'not-an-integer', name: 'Broken' }] })
      )
    );

    const response = await authorizedRequest();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });

  it('requires authentication', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request('/api/v1/billing/methods', undefined, env);
    expect(response.status).toBe(401);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('does not forward an allowlisted browser Origin outside checkout', async () => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/billing/methods',
      {
        headers: {
          Authorization: 'Bearer opaque-token',
          Origin: 'https://client.example',
        },
      },
      env
    );

    expect(response.status).toBe(200);
    expect(new Headers(upstreamFetch.mock.calls[0][1]?.headers).has('origin')).toBe(
      false
    );
  });
});
