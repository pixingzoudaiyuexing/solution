import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardAuthenticationError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardWalletAdapter } from '../src/adapters/v2board/wallet';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardWalletAdapter {
  return new V2BoardWalletAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

describe('V2BoardWalletAdapter', () => {
  it.each([0, 12_345, 2_147_483_647])(
    'maps balance=%s unchanged from one user/info call',
    async (balance) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: {
            balance,
            email: 'private@example.com',
            uuid: 'private-uuid',
            telegram_id: 99,
            commission_balance: 123,
            commission_rate: 30,
            discount: 10,
            plan_id: 7,
            device_limit: 3,
            last_login_at: 1,
            created_at: 1,
          },
        })
      );

      await expect(
        createAdapter(fetcher).wallet('opaque-token')
      ).resolves.toEqual({ balanceMinor: balance });
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe('https://backend.example/api/v1/user/info');
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('manual');
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
    }
  );

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['string', '12345'],
    ['null', null],
    ['above signed INT', 2_147_483_648],
  ])('fails closed on %s balance', async (_case, balance) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: { balance } }))
    );
    await expect(adapter.wallet('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it.each([
    {},
    { data: null },
    { data: {} },
    { balance: 12345 },
  ])('fails closed on malformed envelope %#', async (payload) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );
    await expect(adapter.wallet('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes authentication, upstream failure, invalid JSON, HTML, and timeout', async () => {
    const auth = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );
    await expect(auth.wallet('opaque-token')).rejects.toBeInstanceOf(
      V2BoardAuthenticationError
    );

    for (const response of [
      jsonResponse({ message: 'The user does not exist' }, 500),
      new Response('{invalid', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response('<h1>private Laravel failure</h1>', { status: 500 }),
    ]) {
      await expect(
        createAdapter(vi.fn<typeof fetch>().mockResolvedValue(response)).wallet(
          'opaque-token'
        )
      ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    }

    const timeoutFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    await expect(
      createAdapter(timeoutFetcher).wallet('opaque-token')
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
    expect(timeoutFetcher).toHaveBeenCalledOnce();
  });
});
