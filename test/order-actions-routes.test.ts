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

describe('GET /api/v1/orders/:id/status', () => {
  it.each([
    [0, 'pending'],
    [3, 'completed'],
    [2, 'cancelled'],
  ] as const)('returns public status for upstream %s', async (upstream, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: upstream }))
    );
    const response = await app.request(
      '/api/v1/orders/order-001/status',
      {
        headers: { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' },
      },
      env
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { id: 'order-001', status },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects invalid id before upstream', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/orders/invalid%20id/status',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads and cancels a pending deposit order through existing generic routes', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: 0 }))
      .mockResolvedValueOnce(jsonResponse({ data: true }));
    vi.stubGlobal('fetch', fetcher);

    const status = await app.request(
      '/api/v1/orders/deposit-order-001/status',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    const cancel = await app.request(
      '/api/v1/orders/deposit-order-001/cancel',
      { method: 'POST', headers: { Authorization: 'Bearer opaque-token' } },
      env
    );

    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      data: { id: 'deposit-order-001', status: 'pending' },
    });
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toMatchObject({ data: { cancelled: true } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('normalizes missing, malformed, unknown, and timeout responses', async () => {
    const cases = [
      [jsonResponse({ message: 'Order does not exist' }, 500), 404, 'ORDER_NOT_FOUND'],
      [jsonResponse({ data: 9 }), 502, 'UPSTREAM_ERROR'],
      [jsonResponse({ message: 'Database unavailable' }, 500), 502, 'UPSTREAM_ERROR'],
    ] as const;
    for (const [upstream, status, code] of cases) {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(upstream));
      const response = await app.request(
        '/api/v1/orders/order-001/status',
        { headers: { Authorization: 'Bearer opaque-token' } },
        env
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const timeout = await app.request(
      '/api/v1/orders/order-001/status',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(timeout.status).toBe(504);
  });
});

describe('POST /api/v1/orders/:id/cancel', () => {
  it('cancels through V2Board without a Gateway status precheck', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true }));
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/orders/order-001/cancel',
      { method: 'POST', headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { cancelled: true } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toContain('/user/order/cancel');
  });

  it.each([
    ['Order does not exist', 404, 'ORDER_NOT_FOUND'],
    ['You can only cancel pending orders', 409, 'ORDER_NOT_CANCELLABLE'],
    ['Cancel failed', 502, 'ORDER_CANCEL_FAILED'],
    ['Unexpected cancel error', 502, 'UPSTREAM_ERROR'],
  ] as const)('normalizes %s', async (message, status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    const response = await app.request(
      '/api/v1/orders/order-001/cancel',
      { method: 'POST', headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).toContain(code);
    expect(text).not.toContain(message);
  });

  it('normalizes timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const response = await app.request(
      '/api/v1/orders/order-001/cancel',
      { method: 'POST', headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(504);
  });

  it('does not log the token, order id, or upstream details', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>sensitive order failure</h1>', { status: 500 })
      )
    );
    await app.request(
      '/api/v1/orders/sensitive-order-id/cancel',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer sensitive-order-token' },
      },
      env
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('sensitive-order-id');
    expect(logged).not.toContain('sensitive-order-token');
    expect(logged).not.toContain('sensitive order failure');
    expect(logged).not.toContain('backend.example');
  });
});
