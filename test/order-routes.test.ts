import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  FRONTEND_ORIGINS: 'https://client.example',
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

  it('does not expose order creation', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      '/api/v1/orders',
      { method: 'POST', headers: { Authorization: 'Bearer opaque-token' } },
      env
    );

    expect(response.status).toBe(404);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
