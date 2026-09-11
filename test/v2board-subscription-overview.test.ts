import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import { V2BoardSubscriptionOverviewAdapter } from '../src/adapters/v2board/subscription-overview';
import {
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardSubscriptionOverviewAdapter {
  return new V2BoardSubscriptionOverviewAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

function overviewPayload(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    plan_id: 7,
    expired_at: 1893456000,
    u: 123,
    d: 456,
    transfer_enable: 107374182400,
    device_limit: 3,
    alive_ip: 1,
    reset_day: 15,
    allow_new_period: 1,
    plan: {
      id: 7,
      name: 'Pro Plan',
      group_id: 2,
      transfer_enable: 100,
      content: '<b>private</b>',
      month_price: 990,
    },
    token: 'private-subscription-token',
    subscribe_url: 'https://backend.example/subscribe?token=private',
    uuid: 'private-uuid',
    email: 'private@example.com',
    ...overrides,
  };
  return {
    data,
  };
}

describe('V2BoardSubscriptionOverviewAdapter', () => {
  it('maps a user with a plan to the minimal public DTO', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(overviewPayload()));
    const adapter = createAdapter(fetcher);

    await expect(adapter.overview('opaque-token')).resolves.toEqual({
      product: { id: '7', name: 'Pro Plan' },
      expiresAt: '2030-01-01T00:00:00.000Z',
      traffic: {
        uploadedBytes: 123,
        downloadedBytes: 456,
        allowanceBytes: 107374182400,
      },
      deviceLimit: 3,
      activeDevices: 1,
      resetDay: 15,
      renewalAllowed: true,
    });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/getSubscribe');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([null, 0])('accepts plan_id=%s as no plan', async (planId) => {
    const { data } = overviewPayload({ plan_id: planId });
    delete data.plan;
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data }))
    );
    await expect(adapter.overview('opaque-token')).resolves.toMatchObject({
      product: null,
    });
  });

  it.each([
    [null, null],
    [1893456000, '2030-01-01T00:00:00.000Z'],
  ])('maps expiry %s without deriving state', async (expiredAt, expected) => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(overviewPayload({ expired_at: expiredAt })))
    );
    await expect(adapter.overview('opaque-token')).resolves.toMatchObject({
      expiresAt: expected,
    });
  });

  it.each([null, 0, 3])('preserves deviceLimit=%s', async (deviceLimit) => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(overviewPayload({ device_limit: deviceLimit })))
    );
    await expect(adapter.overview('opaque-token')).resolves.toMatchObject({
      deviceLimit,
    });
  });

  it.each([null, 0, 15])('preserves resetDay=%s', async (resetDay) => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(overviewPayload({ reset_day: resetDay })))
    );
    await expect(adapter.overview('opaque-token')).resolves.toMatchObject({
      resetDay,
    });
  });

  it.each([
    [0, false],
    [1, true],
    ['0', false],
    ['1', true],
  ] as const)('maps allow_new_period=%s to %s', async (value, expected) => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(overviewPayload({ allow_new_period: value })))
    );
    await expect(adapter.overview('opaque-token')).resolves.toMatchObject({
      renewalAllowed: expected,
    });
  });

  it.each([
    ['negative upload', { u: -1 }],
    ['float download', { d: 1.5 }],
    ['unsafe allowance', { transfer_enable: Number.MAX_SAFE_INTEGER + 1 }],
    ['string timestamp', { expired_at: '1893456000' }],
    ['negative timestamp', { expired_at: -1 }],
    ['malformed plan', { plan: { id: 7, group_id: 2 } }],
    ['plan mismatch', { plan: { id: 8, name: 'Other' } }],
    ['negative device limit', { device_limit: -1 }],
    ['float alive devices', { alive_ip: 1.5 }],
    ['negative reset day', { reset_day: -1 }],
    ['malformed renewal flag', { allow_new_period: 'true' }],
  ])('fails closed on %s', async (_case, overrides) => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(overviewPayload(overrides)))
    );
    await expect(adapter.overview('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it.each([
    'plan_id',
    'expired_at',
    'u',
    'd',
    'transfer_enable',
    'device_limit',
    'alive_ip',
    'reset_day',
    'allow_new_period',
  ])(
    'fails closed when required field %s is missing',
    async (field) => {
      const { data } = overviewPayload();
      delete data[field];
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data }))
      );
      await expect(adapter.overview('opaque-token')).rejects.toBeInstanceOf(
        V2BoardUpstreamError
      );
    }
  );

  it('normalizes upstream error and timeout', async () => {
    const failed = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Subscription plan does not exist' }, 500)
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
