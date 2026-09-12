import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardAuthenticationError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
  V2BoardWalletDepositAmountInvalidError,
  V2BoardWalletDepositCreateError,
  V2BoardWalletDepositUnavailableError,
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

  it.each([1, 1_000, 2_147_483_647])(
    'creates deposit amount=%s through one exact order/save call',
    async (amountMinor) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: 'deposit-order-001', internal: 'must-not-leak' })
      );
      const adapter = createAdapter(fetcher);

      await expect(
        adapter.createDeposit('opaque-token', amountMinor)
      ).resolves.toEqual({ id: 'deposit-order-001' });
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0];
      expect(url).toBe('https://backend.example/api/v1/user/order/save');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('manual');
      expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
      expect(JSON.parse(String(init?.body))).toEqual({
        plan_id: 0,
        period: 'deposit',
        deposit_amount: amountMinor,
      });
    }
  );

  it.each([
    [
      'You have an unpaid or pending order, please try again later or cancel it',
      V2BoardWalletDepositUnavailableError,
    ],
    [
      '您有未付款或开通中的订单，请稍后再试或将其取消',
      V2BoardWalletDepositUnavailableError,
    ],
    [
      'Failed to create order, deposit amount must be greater than 0',
      V2BoardWalletDepositAmountInvalidError,
    ],
    [
      'Deposit amount too large, please contact the administrator',
      V2BoardWalletDepositAmountInvalidError,
    ],
    ['Failed to create order', V2BoardWalletDepositCreateError],
    ['订单创建失败', V2BoardWalletDepositCreateError],
  ])('maps exact deposit error %s', async (message, ErrorType) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    await expect(
      adapter.createDeposit('opaque-token', 1_000)
    ).rejects.toBeInstanceOf(ErrorType);
  });

  it.each([
    {},
    { data: null },
    { data: 1 },
    { data: 'invalid order id!' },
    [],
  ])('fails closed on malformed deposit success %#', async (payload) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );
    await expect(
      adapter.createDeposit('opaque-token', 1_000)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('normalizes deposit auth, unknown, invalid JSON, HTML, and timeout without retry', async () => {
    const auth = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: 'Session expired' }, 403)
    );
    await expect(
      createAdapter(auth).createDeposit('opaque-token', 1_000)
    ).rejects.toBeInstanceOf(V2BoardAuthenticationError);
    expect(auth).toHaveBeenCalledOnce();

    for (const response of [
      jsonResponse({ message: 'Unknown deposit state' }, 500),
      new Response('{invalid', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response('<h1>private Laravel failure</h1>', { status: 500 }),
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        createAdapter(fetcher).createDeposit('opaque-token', 1_000)
      ).rejects.toBeInstanceOf(V2BoardUpstreamError);
      expect(fetcher).toHaveBeenCalledOnce();
    }

    const timeout = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    await expect(
      createAdapter(timeout).createDeposit('opaque-token', 1_000)
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
    expect(timeout).toHaveBeenCalledOnce();
  });
});
