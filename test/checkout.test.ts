import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  FRONTEND_ORIGINS: 'https://client.example,https://admin.example',
  V2BOARD_BASE_URL: 'https://private.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function checkout(
  upstreamBody: unknown,
  options: {
    status?: number;
    origin?: string;
    headers?: HeadersInit;
    requestBody?: unknown;
  } = {}
): Promise<{ response: Response; upstreamFetch: ReturnType<typeof vi.fn<typeof fetch>> }> {
  const upstreamFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse(upstreamBody, options.status));
  vi.stubGlobal('fetch', upstreamFetch);

  const headers = new Headers({
    Authorization: 'Bearer opaque-token',
    'Content-Type': 'application/json',
    'cf-ray': 'request-id',
  });
  if (options.origin) headers.set('Origin', options.origin);
  new Headers(options.headers).forEach((value, name) => headers.set(name, value));

  const response = await app.request(
    '/api/v1/orders/order-001/checkout',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(
        options.requestBody ?? { paymentMethodId: '3' }
      ),
    },
    env
  );

  return { response, upstreamFetch };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/v1/orders/:id/checkout', () => {
  it('maps V2Board type -1 to finished', async () => {
    const { response, upstreamFetch } = await checkout({
      type: -1,
      data: true,
      payment: { merchant: 'must-not-leak' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { type: 'finished' },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');

    const [url, init] = upstreamFetch.mock.calls[0];
    expect(url).toBe('https://private.example/api/v1/user/order/checkout');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(JSON.parse(String(init?.body))).toEqual({
      trade_no: 'order-001',
      method: 3,
    });
  });

  it.each([
    ['https QR content', 'https://pay.example/qr/123'],
    ['payment URI QR content', 'weixin://wxpay/bizpayurl?pr=abc'],
  ])('maps type 0 %s to opaque qrcode data', async (_case, data) => {
    const { response } = await checkout({ type: 0, data });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { type: 'qrcode', data },
    });
  });

  it('maps a safe type 1 target to redirect', async () => {
    const { response } = await checkout({
      type: 1,
      data: 'https://pay.example/checkout/session-1',
    }, { origin: 'https://client.example' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        type: 'redirect',
        target: 'https://pay.example/checkout/session-1',
      },
    });
  });

  it.each([
    [-1, true],
    [2, true],
  ])('maps successful synchronous type %s to finished', async (type, data) => {
    const { response } = await checkout({ type, data });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { type: 'finished' } });
  });

  it.each([
    ['type -1 false', { type: -1, data: false }],
    ['type 2 false', { type: 2, data: false }],
    ['type 2 malformed', { type: 2, data: 'true' }],
    ['unknown type', { type: 9, data: 'unknown' }],
    ['empty QR', { type: 0, data: '' }],
    ['QR control characters', { type: 0, data: 'pay\nload' }],
    ['oversized QR', { type: 0, data: 'a'.repeat(4097) }],
  ])('fails closed for %s', async (_case, upstreamBody) => {
    const { response } = await checkout(upstreamBody);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'PAYMENT_CREATE_FAILED' },
    });
  });

  it('rejects an unsafe redirect without exposing its target', async () => {
    const target = 'http://127.0.0.1/internal-payment';
    const { response } = await checkout({ type: 1, data: target });
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('PAYMENT_CREATE_FAILED');
    expect(body).not.toContain(target);
  });

  it('forwards an exact allowlisted frontend Origin only for checkout', async () => {
    const { upstreamFetch } = await checkout(
      { type: 0, data: 'https://pay.example/qr/123' },
      { origin: 'https://client.example' }
    );
    const headers = new Headers(upstreamFetch.mock.calls[0][1]?.headers);
    expect(headers.get('origin')).toBe('https://client.example');
  });

  it('does not forward a disallowed Origin or spoofed host headers', async () => {
    const { upstreamFetch } = await checkout(
      { type: 0, data: 'https://pay.example/qr/123' },
      {
        origin: 'https://attacker.example',
        headers: {
          Host: 'attacker.example',
          'X-Forwarded-Host': 'attacker.example',
          'X-Original-Host': 'attacker.example',
          'X-Forwarded-Proto': 'javascript',
        },
      }
    );
    const headers = new Headers(upstreamFetch.mock.calls[0][1]?.headers);
    expect(headers.has('origin')).toBe(false);
    expect(headers.has('host')).toBe(false);
    expect(headers.has('x-forwarded-host')).toBe(false);
    expect(headers.has('x-original-host')).toBe(false);
    expect(headers.has('x-forwarded-proto')).toBe(false);
  });

  it('does not forward an allowlisted non-HTTPS Origin', async () => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ type: 0, data: 'opaque-qr' }));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders/order-001/checkout',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer opaque-token',
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ paymentMethodId: '3' }),
      },
      { ...env, FRONTEND_ORIGINS: 'http://localhost:3000' }
    );

    expect(response.status).toBe(200);
    expect(new Headers(upstreamFetch.mock.calls[0][1]?.headers).has('origin')).toBe(
      false
    );
  });

  it('requires authentication before parsing checkout input', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);
    const response = await app.request(
      '/api/v1/orders/order-001/checkout',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
      env
    );
    expect(response.status).toBe(401);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing paymentMethodId', {}],
    ['zero paymentMethodId', { paymentMethodId: '0' }],
    ['oversized paymentMethodId', { paymentMethodId: '2147483648' }],
    ['invalid paymentMethodId', { paymentMethodId: 'not-an-id' }],
    ['extra token', { paymentMethodId: '3', token: 'card-token' }],
  ])('rejects invalid request: %s', async (_case, requestBody) => {
    const { response, upstreamFetch } = await checkout(
      { type: 0, data: 'ignored' },
      { requestBody }
    );
    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('maps invalid auth to AUTH_FAILED', async () => {
    const { response } = await checkout(
      { message: 'Session expired' },
      { status: 403 }
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_FAILED' },
    });
  });

  it.each([
    'Payment method is not available',
    '支付方式不可用',
  ])('maps unavailable method without exposing: %s', async (message) => {
    const { response } = await checkout({ message }, { status: 500 });
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain('PAYMENT_METHOD_UNAVAILABLE');
    expect(body).not.toContain(message);
  });

  it('maps other JSON business errors to PAYMENT_CREATE_FAILED', async () => {
    const { response } = await checkout(
      { message: 'Provider merchant configuration failed' },
      { status: 500 }
    );
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('PAYMENT_CREATE_FAILED');
    expect(body).not.toContain('merchant configuration');
  });

  it('normalizes HTML errors', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<h1>Laravel payment error</h1>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders/order-001/checkout',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer opaque-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paymentMethodId: '3' }),
      },
      env
    );
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).toContain('UPSTREAM_ERROR');
    expect(body).not.toContain('Laravel payment error');
  });

  it('normalizes malformed JSON', async () => {
    const upstreamFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{invalid', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders/order-001/checkout',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer opaque-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paymentMethodId: '3' }),
      },
      env
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });

  it('preserves the shared timeout error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('The operation timed out', 'TimeoutError')
      )
    );
    const response = await app.request(
      '/api/v1/orders/order-001/checkout',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer opaque-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paymentMethodId: '3' }),
      },
      env
    );
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_TIMEOUT' },
    });
  });

  it('does not log payment payloads, redirect targets, merchant fields, or token', async () => {
    const sensitiveTarget = 'http://127.0.0.1/?merchant=secret-merchant';
    const token = 'sensitive-checkout-token';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          type: 1,
          data: sensitiveTarget,
          merchant: { pid: 'secret-pid', key: 'secret-key' },
        })
      )
    );

    const response = await app.request(
      '/api/v1/orders/order-001/checkout',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paymentMethodId: '3' }),
      },
      env
    );

    expect(response.status).toBe(502);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(sensitiveTarget);
    expect(logged).not.toContain('secret-merchant');
    expect(logged).not.toContain('secret-pid');
    expect(logged).not.toContain('secret-key');
    expect(logged).not.toContain(token);
  });
});
