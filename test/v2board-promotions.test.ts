import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardPromotionInvalidError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardPromotionsAdapter } from '../src/adapters/v2board/promotions';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardPromotionsAdapter {
  return new V2BoardPromotionsAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

describe('V2BoardPromotionsAdapter', () => {
  it.each([
    [1, 500, { type: 'fixed', amountMinor: 500 }],
    [2, 125, { type: 'percentage', percent: 125 }],
  ] as const)('maps coupon type %s to a minimal DTO', async (type, value, discount) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          id: 7,
          code: 'PROMO123',
          name: 'private name',
          type,
          value,
          limit_use: 3,
          limit_use_with_user: 1,
          limit_plan_ids: [9],
          started_at: 1,
          ended_at: 2,
        },
      })
    );
    const adapter = createAdapter(fetcher);
    await expect(
      adapter.validatePromotion('opaque-token', { code: 'PROMO123', productId: 9 })
    ).resolves.toEqual({ valid: true, discount });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/coupon/check');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(JSON.parse(String(init?.body))).toEqual({ code: 'PROMO123', plan_id: 9 });
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it.each([
    'Invalid coupon',
    '优惠券无效',
    'This coupon is no longer available',
    '优惠券已无可用次数',
    'This coupon has not yet started',
    '优惠券还未到可用时间',
    'This coupon has expired',
    '优惠券已过期',
    'The coupon code cannot be used for this subscription',
    '该订阅无法使用此优惠码',
    'The coupon code cannot be used for this period',
    '此优惠券无法用于该付款周期',
    'The coupon can only be used 2 per person',
    '该优惠券每人只能用 2 次',
  ])('maps exact coupon rejection: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    await expect(
      adapter.validatePromotion('opaque-token', { code: 'PROMO123', productId: 9 })
    ).rejects.toBeInstanceOf(V2BoardPromotionInvalidError);
  });

  it('does not classify an error that only contains a known message', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Invalid coupon: PROMO123' }, 500)
      )
    );
    await expect(
      adapter.validatePromotion('opaque-token', { code: 'PROMO123', productId: 9 })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([
    'The coupon can only be used two per person',
    'The coupon can only be used 2 per person extra',
    '该优惠券每人只能用 2 次 extra',
  ])('does not classify malformed dynamic rejection: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    await expect(
      adapter.validatePromotion('opaque-token', { code: 'PROMO123', productId: 9 })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([
    { data: { type: 3, value: 10 } },
    { data: { type: 1, value: -1 } },
    { data: { type: 2, value: 2_147_483_648 } },
    { data: { type: 2, value: 10.5 } },
    { data: { type: 1 } },
  ])('fails closed on malformed coupon %#', async (payload) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );
    await expect(
      adapter.validatePromotion('opaque-token', { code: 'PROMO123', productId: 9 })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('normalizes unknown failure and timeout', async () => {
    const unknown = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Database unavailable' }, 500)
      )
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const request = { code: 'PROMO123', productId: 9 };
    await expect(
      unknown.validatePromotion('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timeout.validatePromotion('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });
});
