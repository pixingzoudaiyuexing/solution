import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardAuthenticationError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardSubscriptionAdapter } from '../src/adapters/v2board/subscription';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function adapter(fetcher: typeof fetch): V2BoardSubscriptionAdapter {
  return new V2BoardSubscriptionAdapter(
    new V2BoardClient(
      { baseUrl: 'https://private.example/api/v1/' },
      fetcher
    ),
    new V2BoardClient({ baseUrl: 'https://private.example/' }, fetcher),
    '/hidden-subscribe'
  );
}

function eligibilityData(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      banned: 0,
      transfer_enable: 1024,
      expired_at: 253_402_300_799,
      plan_id: null,
      ...overrides,
    },
  };
}

describe('V2BoardSubscriptionAdapter current entitlement', () => {
  it.each([
    ['active subscription without historical-order evidence', {}],
    ['permanent subscription', { expired_at: null }],
  ])('accepts %s from official user/info', async (_case, overrides) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(eligibilityData(overrides)));

    await expect(adapter(fetcher).accessEligible('opaque-auth')).resolves.toBe(
      true
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://private.example/api/v1/user/info'
    );
  });

  it.each([
    ['expired subscription', { expired_at: 1 }],
    ['banned account', { banned: 1 }],
    ['zero transfer allowance', { transfer_enable: 0 }],
  ])('rejects %s from official user/info', async (_case, overrides) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(eligibilityData(overrides)));

    await expect(adapter(fetcher).accessEligible('opaque-auth')).resolves.toBe(
      false
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    {},
    { data: {} },
    eligibilityData({ banned: '0' }),
    eligibilityData({ transfer_enable: -1 }),
    eligibilityData({ expired_at: '1893456000' }),
  ])('fails closed on malformed entitlement payload %#', async (payload) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(payload));

    await expect(adapter(fetcher).accessEligible('opaque-auth')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('preserves authentication failure semantics', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'private' }, 403));

    await expect(adapter(fetcher).accessEligible('opaque-auth')).rejects.toBeInstanceOf(
      V2BoardAuthenticationError
    );
  });
});
