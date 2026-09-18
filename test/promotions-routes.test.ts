import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

const env = {
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function validate(body: unknown): Promise<Response> {
  return app.request(
    '/api/v1/promotions/validate',
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
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/v1/promotions/validate', () => {
  it('returns only the public promotion DTO', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          id: 7,
          code: 'PROMO123',
          name: 'private name',
          type: 1,
          value: 500,
          limit_use: 3,
          limit_plan_ids: [9],
          used_user_ids: [1],
        },
      })
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await validate({ code: 'PROMO123', productId: 9 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { valid: true, discount: { type: 'fixed', amountMinor: 500 } },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      code: 'PROMO123',
      plan_id: 9,
    });
  });

  it.each([
    ['missing code', { productId: 9 }],
    ['empty code', { code: '', productId: 9 }],
    ['long code', { code: 'x'.repeat(256), productId: 9 }],
    ['missing product', { code: 'PROMO123' }],
    ['string product', { code: 'PROMO123', productId: '9' }],
    ['zero product', { code: 'PROMO123', productId: 0 }],
    ['fractional product', { code: 'PROMO123', productId: 1.5 }],
    ['extra field', { code: 'PROMO123', productId: 9, plan_id: 9 }],
  ])('rejects %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await validate(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires authorization before reading the request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/promotions/validate',
      { method: 'POST', body: '{invalid' },
      env
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'Invalid coupon',
    'The coupon code cannot be used for this subscription',
    'The coupon can only be used 2 per person',
    '该优惠券每人只能用 2 次',
  ])('normalizes coupon rejection: %s', async (message) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    const response = await validate({ code: 'PROMO123', productId: 9 });
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).toContain('PROMOTION_INVALID');
    expect(text).not.toContain(message);
  });

  it('normalizes malformed, unknown, and timeout responses', async () => {
    for (const upstream of [
      jsonResponse({ data: { type: 1 } }),
      jsonResponse({ message: 'Database unavailable' }, 500),
    ]) {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(upstream));
      const response = await validate({ code: 'PROMO123', productId: 9 });
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const timeout = await validate({ code: 'PROMO123', productId: 9 });
    expect(timeout.status).toBe(504);
  });

  it('does not log coupon code, token, or upstream internals', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>sensitive coupon failure</h1>', { status: 500 })
      )
    );
    await validate({ code: 'SENSITIVE-CODE', productId: 9 });
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('SENSITIVE-CODE');
    expect(logged).not.toContain('opaque-token');
    expect(logged).not.toContain('sensitive coupon failure');
    expect(logged).not.toContain('backend.example');
  });
});
