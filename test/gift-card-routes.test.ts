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

async function redeem(body: unknown, authenticated = true): Promise<Response> {
  return app.request(
    '/api/v1/gift-cards/redeem',
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/v1/gift-cards/redeem', () => {
  it('maps only the public code to the official upstream request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: true,
        type: 1,
        value: 1000,
        giftcard: 'must-not-leak',
        plan_id: 7,
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await redeem({ code: 'MixedCaseGiftCard' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        redeemed: true,
        effect: { type: 'balance', amountMinor: 1000 },
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/redeemgiftcard'
    );
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      giftcard: 'MixedCaseGiftCard',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('MixedCaseGiftCard');
    expect(serialized).not.toContain('giftcard');
    expect(serialized).not.toContain('plan_id');
  });

  it('preserves leading and trailing credential characters', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true, type: 4, value: null }));
    vi.stubGlobal('fetch', fetcher);

    const response = await redeem({ code: ' ExactCode ' });

    expect(response.status).toBe(200);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      giftcard: ' ExactCode ',
    });
  });

  it.each([
    ['missing code', {}],
    ['empty code', { code: '' }],
    ['long code', { code: 'x'.repeat(256) }],
    ['numeric code', { code: 123 }],
    ['upstream alias', { giftcard: 'GiftCard123' }],
    ['id', { code: 'GiftCard123', id: 1 }],
    ['type', { code: 'GiftCard123', type: 1 }],
    ['value', { code: 'GiftCard123', value: 100 }],
    ['planId', { code: 'GiftCard123', planId: '7' }],
    ['userId', { code: 'GiftCard123', userId: '9' }],
  ])('rejects %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await redeem(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires Authorization before reading the request body', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/gift-cards/redeem',
      { method: 'POST', body: '{invalid' },
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps invalid upstream Authorization to AUTH_FAILED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );

    const response = await redeem({ code: 'GiftCard123' });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_FAILED' } });
  });

  it.each([
    ['The gift card does not exist', 404, 'GIFT_CARD_NOT_FOUND'],
    ['The gift card is not yet valid', 409, 'GIFT_CARD_NOT_ACTIVE'],
    ['The gift card has expired', 409, 'GIFT_CARD_EXPIRED'],
    [
      'The gift card usage limit has been reached',
      409,
      'GIFT_CARD_USAGE_LIMIT_REACHED',
    ],
    [
      'The gift card has already been used by this user',
      409,
      'GIFT_CARD_ALREADY_REDEEMED',
    ],
    ['Not suitable gift card type', 409, 'GIFT_CARD_NOT_APPLICABLE'],
    ['Save failed', 502, 'GIFT_CARD_REDEEM_FAILED'],
  ] as const)('normalizes %s', async (message, status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    const response = await redeem({ code: 'SensitiveGiftCardCode' });
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(text).toContain(code);
    expect(text).not.toContain(message);
    expect(text).not.toContain('SensitiveGiftCardCode');
  });

  it('normalizes malformed success, unknown failure, and timeout without retry', async () => {
    for (const upstream of [
      jsonResponse({ data: false, type: 1, value: 100 }),
      jsonResponse({ message: 'Unexpected database failure' }, 500),
    ]) {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(upstream));
      const response = await redeem({ code: 'SensitiveGiftCardCode' });
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        error: { code: 'UPSTREAM_ERROR' },
      });
    }

    const timeoutFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', timeoutFetcher);
    const timeout = await redeem({ code: 'SensitiveGiftCardCode' });
    expect(timeout.status).toBe(504);
    expect(await timeout.json()).toMatchObject({
      error: { code: 'UPSTREAM_TIMEOUT' },
    });
    expect(timeoutFetcher).toHaveBeenCalledOnce();
  });

  it('does not log the code, token, or raw upstream response', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>private gift card failure</h1>', { status: 500 })
      )
    );

    await redeem({ code: 'SensitiveGiftCardCode' });

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('SensitiveGiftCardCode');
    expect(logged).not.toContain('opaque-token');
    expect(logged).not.toContain('private gift card failure');
    expect(logged).not.toContain('backend.example');
  });
});
