import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardAuthenticationError,
  V2BoardCommissionTransferError,
  V2BoardInsufficientCommissionBalanceError,
  V2BoardReferralCodeLimitError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
  V2BoardWithdrawalDisabledError,
  V2BoardWithdrawalMethodUnsupportedError,
  V2BoardWithdrawalMinimumNotMetError,
  V2BoardWithdrawalRequestError,
} from '../src/adapters/v2board/errors';
import { V2BoardReferralsAdapter } from '../src/adapters/v2board/referrals';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardReferralsAdapter {
  return new V2BoardReferralsAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

function upstreamCode(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    user_id: 99,
    code: 'AbCd1234',
    status: 0,
    pv: 7,
    created_at: 1704067200,
    updated_at: 1704153600,
    ...overrides,
  };
}

function overviewPayload(
  codes: unknown[] = [],
  stat: unknown[] = [0, 0, 0, 10, 0]
) {
  return { data: { codes, stat, internal: 'must-not-leak' } };
}

function upstreamCommission(overrides: Record<string, unknown> = {}) {
  return {
    id: 31,
    trade_no: 'other-users-private-order',
    order_amount: 1000,
    get_amount: 137,
    created_at: 1704067200,
    ...overrides,
  };
}

describe('V2BoardReferralsAdapter overview', () => {
  it('maps an empty code list and all-zero stats', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(overviewPayload([], [0, 0, 0, 0, 0]))
      )
    );

    await expect(adapter.overview('opaque-token')).resolves.toEqual({
      codes: [],
      stats: {
        registeredUsers: 0,
        earnedCommissionMinor: 0,
        pendingCommissionMinor: 0,
        commissionRatePercent: 0,
        availableCommissionMinor: 0,
      },
    });
  });

  it('maps multiple code DTOs and the exact positional stats without internals', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        overviewPayload(
          [upstreamCode(), upstreamCode({ code: 'ZyXw9876', created_at: 1704153600 })],
          [10, 1200, 300, 30, 900]
        )
      )
    );
    const adapter = createAdapter(fetcher);

    await expect(adapter.overview('opaque-token')).resolves.toEqual({
      codes: [
        { code: 'AbCd1234', createdAt: '2024-01-01T00:00:00.000Z' },
        { code: 'ZyXw9876', createdAt: '2024-01-02T00:00:00.000Z' },
      ],
      stats: {
        registeredUsers: 10,
        earnedCommissionMinor: 1200,
        pendingCommissionMinor: 300,
        commissionRatePercent: 30,
        availableCommissionMinor: 900,
      },
    });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/invite/fetch');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it.each([
    ['missing code', upstreamCode({ code: undefined })],
    ['empty code', upstreamCode({ code: '' })],
    ['oversized code', upstreamCode({ code: 'x'.repeat(33) })],
    ['non-alphanumeric code', upstreamCode({ code: 'ABC-123' })],
    ['negative timestamp', upstreamCode({ created_at: -1 })],
    ['string timestamp', upstreamCode({ created_at: '1704067200' })],
  ])('fails closed on malformed code: %s', async (_case, code) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(overviewPayload([code]))
      )
    );
    await expect(adapter.overview('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it.each([
    ['wrong tuple length', [0, 0, 0, 10]],
    ['negative users', [-1, 0, 0, 10, 0]],
    ['float earned amount', [0, 1.5, 0, 10, 0]],
    ['negative pending amount', [0, 0, -1, 10, 0]],
    ['float rate', [0, 0, 0, 10.5, 0]],
    ['rate over 100', [0, 0, 0, 101, 0]],
    ['negative available amount', [0, 0, 0, 10, -1]],
    ['unsafe amount', [0, Number.MAX_SAFE_INTEGER + 1, 0, 10, 0]],
    ['string amount', [0, '1200', 0, 10, 0]],
  ])('fails closed on malformed stats: %s', async (_case, stat) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(overviewPayload([], stat))
      )
    );
    await expect(adapter.overview('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it.each([
    {},
    { data: null },
    { data: { codes: [] } },
    { data: { stat: [0, 0, 0, 10, 0] } },
  ])('fails closed on malformed envelope %#', async (payload) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );
    await expect(adapter.overview('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes upstream failure and timeout', async () => {
    const failed = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Database unavailable' }, 500)
      )
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    await expect(failed.overview('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(timeout.overview('opaque-token')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });
});

describe('V2BoardReferralsAdapter code creation', () => {
  it('uses the official GET endpoint once and returns only created=true', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: true, code: 'must-not-be-used' })
    );
    const adapter = createAdapter(fetcher);

    await expect(adapter.createCode('opaque-token')).resolves.toEqual({ created: true });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/invite/save');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe('manual');
  });

  it.each([
    'The maximum number of creations has been reached',
    '已达到创建数量上限',
  ])('maps the exact creation limit message: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    await expect(adapter.createCode('opaque-token')).rejects.toBeInstanceOf(
      V2BoardReferralCodeLimitError
    );
  });

  it('does not classify a partial limit message', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          { message: 'The maximum number of creations has been reached: SQL error' },
          500
        )
      )
    );
    await expect(adapter.createCode('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it.each([{ data: false }, { data: 1 }, { created: true }])(
    'fails closed on malformed success %#',
    async (payload) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
      );
      await expect(adapter.createCode('opaque-token')).rejects.toBeInstanceOf(
        V2BoardUpstreamError
      );
    }
  );

  it('normalizes unknown failure and timeout', async () => {
    const failed = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Random generator unavailable' }, 500)
      )
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    await expect(failed.createCode('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(timeout.createCode('opaque-token')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });
});

describe('V2BoardReferralsAdapter commission history', () => {
  it('maps an empty page and pagination', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: [], total: 0 })
    );
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.commissions('opaque-token', { page: 2, pageSize: 20 })
    ).resolves.toEqual({ items: [], page: 2, pageSize: 20, total: 0 });
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/invite/details?current=2&page_size=20'
    );
  });

  it('maps multiple commission records in upstream order without ids or trade_no', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [
            upstreamCommission(),
            upstreamCommission({
              id: 32,
              trade_no: 'another-private-order',
              order_amount: 2500,
              get_amount: 333,
              created_at: 1704153600,
            }),
          ],
          total: 2,
        })
      )
    );

    await expect(
      adapter.commissions('opaque-token', { page: 1, pageSize: 100 })
    ).resolves.toEqual({
      items: [
        {
          orderAmountMinor: 1000,
          commissionAmountMinor: 137,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        {
          orderAmountMinor: 2500,
          commissionAmountMinor: 333,
          createdAt: '2024-01-02T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 100,
      total: 2,
    });
  });

  it.each([
    ['negative order amount', upstreamCommission({ order_amount: -1 })],
    ['float order amount', upstreamCommission({ order_amount: 10.5 })],
    ['negative commission', upstreamCommission({ get_amount: -1 })],
    ['float commission', upstreamCommission({ get_amount: 1.5 })],
    ['string amount', upstreamCommission({ order_amount: '1000' })],
    ['negative timestamp', upstreamCommission({ created_at: -1 })],
    ['string timestamp', upstreamCommission({ created_at: '1704067200' })],
  ])('fails closed on malformed commission: %s', async (_case, record) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: [record], total: 1 })
      )
    );
    await expect(
      adapter.commissions('opaque-token', { page: 1, pageSize: 20 })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])(
    'fails closed on malformed total %s',
    async (total) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [], total }))
      );
      await expect(
        adapter.commissions('opaque-token', { page: 1, pageSize: 20 })
      ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    }
  );

  it('normalizes malformed envelope and timeout', async () => {
    const malformed = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: null, total: 0 }))
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    await expect(
      malformed.commissions('opaque-token', { page: 1, pageSize: 20 })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timeout.commissions('opaque-token', { page: 1, pageSize: 20 })
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });
});

describe('V2BoardReferralsAdapter commission transfer', () => {
  it('submits the exact amount once and accepts data=true without a follow-up read', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: true, balance: 999, order: 'must-not-leak' })
    );
    const adapter = createAdapter(fetcher);

    await expect(adapter.transferCommission('opaque-token', 137)).resolves.toEqual({
      transferred: true,
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/transfer');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ transfer_amount: 137 });
  });

  it.each([
    'Insufficient commission balance',
    '推广佣金余额不足',
  ])('maps exact insufficient balance error: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    await expect(
      adapter.transferCommission('opaque-token', 1)
    ).rejects.toBeInstanceOf(V2BoardInsufficientCommissionBalanceError);
  });

  it.each([
    'Transfer failed',
    '划转失败',
    'The user does not exist',
    '该用户不存在',
  ])('maps exact transfer failure: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    await expect(
      adapter.transferCommission('opaque-token', 1)
    ).rejects.toBeInstanceOf(V2BoardCommissionTransferError);
  });

  it.each([
    { data: false },
    { data: null },
    {},
    { data: 'true' },
    [],
  ])('fails closed on malformed success %#', async (payload) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );
    await expect(
      adapter.transferCommission('opaque-token', 1)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('does not classify partial or unknown upstream messages', async () => {
    const partial = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Insufficient commission balance: SQL error' }, 500)
      )
    );
    const unknown = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Unexpected transfer state' }, 500)
      )
    );

    await expect(
      partial.transferCommission('opaque-token', 1)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      unknown.transferCommission('opaque-token', 1)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('normalizes HTML, invalid JSON, auth, and timeout without retry', async () => {
    const html = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>private transfer failure</h1>', { status: 500 })
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
    const auth = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );
    const timeoutFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const timeout = createAdapter(timeoutFetcher);

    await expect(html.transferCommission('opaque-token', 1)).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(
      invalidJson.transferCommission('opaque-token', 1)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(auth.transferCommission('opaque-token', 1)).rejects.toBeInstanceOf(
      V2BoardAuthenticationError
    );
    await expect(
      timeout.transferCommission('opaque-token', 1)
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
    expect(timeoutFetcher).toHaveBeenCalledOnce();
  });
});

describe('V2BoardReferralsAdapter withdrawal options', () => {
  it.each([
    [0, true],
    [1, false],
  ] as const)('maps withdraw_close=%s and strips unrelated config', async (withdrawClose, enabled) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          withdraw_close: withdrawClose,
          withdraw_methods: ['支付宝', 'USDT', 'Paypal'],
          stripe_pk: 'must-not-leak',
          is_telegram: 1,
          commission_distribution_enable: 1,
        },
      })
    );
    const adapter = createAdapter(fetcher);

    await expect(adapter.withdrawalOptions('opaque-token')).resolves.toEqual({
      enabled,
      methods: ['支付宝', 'USDT', 'Paypal'],
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/comm/config');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it('keeps an empty method list when withdrawal is disabled', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: { withdraw_close: 1, withdraw_methods: [] } })
      )
    );

    await expect(adapter.withdrawalOptions('opaque-token')).resolves.toEqual({
      enabled: false,
      methods: [],
    });
  });

  it.each([
    ['boolean close', { withdraw_close: false, withdraw_methods: [] }],
    ['string close', { withdraw_close: '0', withdraw_methods: [] }],
    ['unknown close', { withdraw_close: 2, withdraw_methods: [] }],
    ['missing methods', { withdraw_close: 0 }],
    ['non-array methods', { withdraw_close: 0, withdraw_methods: 'USDT' }],
    ['empty method', { withdraw_close: 0, withdraw_methods: [''] }],
    ['oversized method', { withdraw_close: 0, withdraw_methods: ['x'.repeat(256)] }],
  ])('fails closed on malformed options: %s', async (_case, data) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data }))
    );

    await expect(adapter.withdrawalOptions('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes authentication failure and timeout', async () => {
    const auth = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );

    await expect(auth.withdrawalOptions('opaque-token')).rejects.toBeInstanceOf(
      V2BoardAuthenticationError
    );
    await expect(timeout.withdrawalOptions('opaque-token')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });
});

describe('V2BoardReferralsAdapter withdrawal request', () => {
  const request = {
    method: 'USDT',
    account: 'SUPER_SECRET_WITHDRAWAL_ACCOUNT_123',
  };

  it('submits only official fields once and accepts data=true without a follow-up read', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: true, ticket_id: 7, account: request.account })
    );
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.requestWithdrawal('opaque-token', request)
    ).resolves.toEqual({ requested: true });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/ticket/withdraw');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({
      withdraw_method: 'USDT',
      withdraw_account: request.account,
    });
  });

  it.each([
    ['user.ticket.withdraw.not_support_withdraw', V2BoardWithdrawalDisabledError],
    ['Unsupported withdrawal method', V2BoardWithdrawalMethodUnsupportedError],
    ['不支持的提现方式', V2BoardWithdrawalMethodUnsupportedError],
    [
      'The current required minimum withdrawal commission is 100',
      V2BoardWithdrawalMinimumNotMetError,
    ],
    ['当前系统要求的最少提现佣金为：¥100CNY', V2BoardWithdrawalMinimumNotMetError],
    ['Failed to open ticket', V2BoardWithdrawalRequestError],
    ['工单创建失败', V2BoardWithdrawalRequestError],
  ])('maps confirmed complete error %s', async (message, ErrorType) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    await expect(
      adapter.requestWithdrawal('opaque-token', request)
    ).rejects.toBeInstanceOf(ErrorType);
  });

  it.each([
    'The current required minimum withdrawal commission is 100 CNY',
    'The current required minimum withdrawal commission is unknown',
    'prefix The current required minimum withdrawal commission is 100',
    '当前系统要求的最少提现佣金为：¥100CNY extra',
    'minimum withdrawal is 100',
  ])('does not classify non-official minimum message: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    await expect(
      adapter.requestWithdrawal('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([{ data: false }, { data: null }, {}, { data: 'true' }, []])(
    'fails closed on malformed success %#',
    async (payload) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
      );
      await expect(
        adapter.requestWithdrawal('opaque-token', request)
      ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    }
  );

  it('normalizes HTML, invalid JSON, auth, unknown failure, and timeout without retry', async () => {
    const html = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(`<h1>${request.account}</h1>`, { status: 500 })
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
    const auth = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );
    const unknownFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: `SQL failure ${request.account}` }, 500)
    );
    const unknown = createAdapter(unknownFetcher);
    const timeoutFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const timeout = createAdapter(timeoutFetcher);

    await expect(
      html.requestWithdrawal('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      invalidJson.requestWithdrawal('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      auth.requestWithdrawal('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardAuthenticationError);
    await expect(
      unknown.requestWithdrawal('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timeout.requestWithdrawal('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
    expect(unknownFetcher).toHaveBeenCalledOnce();
    expect(timeoutFetcher).toHaveBeenCalledOnce();
  });
});
