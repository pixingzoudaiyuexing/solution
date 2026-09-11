import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardAuthenticationError,
  V2BoardGiftCardAlreadyRedeemedError,
  V2BoardGiftCardExpiredError,
  V2BoardGiftCardNotActiveError,
  V2BoardGiftCardNotApplicableError,
  V2BoardGiftCardNotFoundError,
  V2BoardGiftCardRedeemError,
  V2BoardGiftCardUsageLimitError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardGiftCardsAdapter } from '../src/adapters/v2board/gift-cards';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function responseWithJson(body: unknown): Response {
  const response = new Response('{}', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  vi.spyOn(response, 'json').mockResolvedValue(body);
  return response;
}

function createAdapter(fetcher: typeof fetch): V2BoardGiftCardsAdapter {
  return new V2BoardGiftCardsAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

describe('V2BoardGiftCardsAdapter effect mapping', () => {
  it.each([
    [
      { data: true, type: 1, value: 1000, code: 'must-not-leak' },
      { redeemed: true, effect: { type: 'balance', amountMinor: 1000 } },
    ],
    [
      { data: true, type: 2, value: 30 },
      { redeemed: true, effect: { type: 'validity', days: 30 } },
    ],
    [
      { data: true, type: 3, value: 100 },
      { redeemed: true, effect: { type: 'traffic', gigabytes: 100 } },
    ],
    [
      { data: true, type: 4, value: null },
      { redeemed: true, effect: { type: 'trafficReset' } },
    ],
    [
      { data: true, type: 4 },
      { redeemed: true, effect: { type: 'trafficReset' } },
    ],
    [
      { data: true, type: 4, value: -2_147_483_648 },
      { redeemed: true, effect: { type: 'trafficReset' } },
    ],
    [
      { data: true, type: 5, value: 30 },
      { redeemed: true, effect: { type: 'plan', durationDays: 30 } },
    ],
    [
      { data: true, type: 5, value: 0 },
      { redeemed: true, effect: { type: 'plan', durationDays: null } },
    ],
  ] as const)('maps official success %# to its public effect', async (payload, expected) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(payload));
    const adapter = createAdapter(fetcher);

    await expect(adapter.redeem('opaque-token', 'GiftCard123')).resolves.toEqual(
      expected
    );
    expect(fetcher).toHaveBeenCalledOnce();

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/redeemgiftcard');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
    expect(JSON.parse(String(init?.body))).toEqual({ giftcard: 'GiftCard123' });
  });

  it('preserves the credential exactly without trimming or changing case', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true, type: 4, value: null }));
    const adapter = createAdapter(fetcher);

    await adapter.redeem('opaque-token', ' MixedCaseCode ');

    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      giftcard: ' MixedCaseCode ',
    });
  });

  it.each([
    [1, { redeemed: true, effect: { type: 'balance', amountMinor: -1 } }],
    [2, { redeemed: true, effect: { type: 'validity', days: -1 } }],
    [3, { redeemed: true, effect: { type: 'traffic', gigabytes: -1 } }],
    [5, { redeemed: true, effect: { type: 'plan', durationDays: -1 } }],
  ] as const)('reports official signed value for type %s verbatim', async (type, expected) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: true, type, value: -1 })
      )
    );

    await expect(adapter.redeem('opaque-token', 'GiftCard123')).resolves.toEqual(
      expected
    );
  });

  it.each([-2_147_483_648, 2_147_483_647])(
    'accepts official signed INT boundary %s after successful mutation',
    async (value) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({ data: true, type: 1, value })
        )
      );

      await expect(adapter.redeem('opaque-token', 'GiftCard123')).resolves.toEqual({
        redeemed: true,
        effect: { type: 'balance', amountMinor: value },
      });
    }
  );
});

describe('V2BoardGiftCardsAdapter strict success validation', () => {
  it.each([
    ['data false', { data: false, type: 1, value: 100 }],
    ['data missing', { type: 1, value: 100 }],
    ['type missing', { data: true, value: 100 }],
    ['type zero', { data: true, type: 0, value: 100 }],
    ['type six', { data: true, type: 6, value: 100 }],
    ['string type', { data: true, type: '1', value: 100 }],
    ['balance missing value', { data: true, type: 1 }],
    ['balance string value', { data: true, type: 1, value: '100' }],
    ['validity float', { data: true, type: 2, value: 1.5 }],
    ['traffic reset string', { data: true, type: 4, value: 'ignored' }],
    ['below signed INT', { data: true, type: 1, value: -2_147_483_649 }],
    ['above signed INT', { data: true, type: 1, value: 2_147_483_648 }],
    [
      'unsafe integer',
      { data: true, type: 1, value: Number.MAX_SAFE_INTEGER + 1 },
    ],
  ])('fails closed on %s', async (_case, payload) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );

    await expect(
      adapter.redeem('opaque-token', 'GiftCard123')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'fails closed on non-finite value %s',
    async (value) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(
          responseWithJson({ data: true, type: 1, value })
        )
      );

      await expect(
        adapter.redeem('opaque-token', 'GiftCard123')
      ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    }
  );
});

describe('V2BoardGiftCardsAdapter errors', () => {
  it.each([
    ['The gift card does not exist', V2BoardGiftCardNotFoundError],
    ['The gift card is not yet valid', V2BoardGiftCardNotActiveError],
    ['The gift card has expired', V2BoardGiftCardExpiredError],
    [
      'The gift card usage limit has been reached',
      V2BoardGiftCardUsageLimitError,
    ],
    [
      'The gift card has already been used by this user',
      V2BoardGiftCardAlreadyRedeemedError,
    ],
    ['Not suitable gift card type', V2BoardGiftCardNotApplicableError],
    ['Giftcard cannot be empty', V2BoardGiftCardRedeemError],
    ['Unknown gift card type', V2BoardGiftCardRedeemError],
    ['Save failed', V2BoardGiftCardRedeemError],
    ['保存失败', V2BoardGiftCardRedeemError],
    ['The user does not exist', V2BoardGiftCardRedeemError],
    ['该用户不存在', V2BoardGiftCardRedeemError],
  ] as const)('maps exact upstream error %s', async (message, ErrorType) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    await expect(
      adapter.redeem('opaque-token', 'GiftCard123')
    ).rejects.toBeInstanceOf(ErrorType);
  });

  it('does not classify a partial business error match', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'The gift card has expired: database error' }, 500)
      )
    );

    await expect(
      adapter.redeem('opaque-token', 'GiftCard123')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('normalizes authentication, unknown JSON, HTML, invalid JSON, and timeout', async () => {
    const auth = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );
    const unknown = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Unexpected internal failure' }, 500)
      )
    );
    const html = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>Laravel error</h1>', { status: 500 })
      )
    );
    const invalidJson = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{invalid', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const timeoutFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const timeout = createAdapter(timeoutFetcher);

    await expect(auth.redeem('opaque-token', 'GiftCard123')).rejects.toBeInstanceOf(
      V2BoardAuthenticationError
    );
    await expect(
      unknown.redeem('opaque-token', 'GiftCard123')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(html.redeem('opaque-token', 'GiftCard123')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(
      invalidJson.redeem('opaque-token', 'GiftCard123')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timeout.redeem('opaque-token', 'GiftCard123')
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
    expect(timeoutFetcher).toHaveBeenCalledOnce();
  });
});
