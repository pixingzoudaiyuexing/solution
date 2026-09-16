import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardAuthenticationError,
  V2BoardSubscriptionAccessUnavailableError,
  V2BoardSubscriptionEntryUnavailableError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardSubscriptionAdapter } from '../src/adapters/v2board/subscription';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardSubscriptionAdapter {
  return new V2BoardSubscriptionAdapter(
    new V2BoardClient(
      { baseUrl: 'https://private.example/api/v1/' },
      fetcher
    ),
    new V2BoardClient({ baseUrl: 'https://private.example/' }, fetcher),
    '/hidden-subscribe'
  );
}

const qualifyingHistory = {
  data: [{ plan_id: 7, status: 3, internal: 'must-not-leak' }],
};

describe('V2BoardSubscriptionAdapter CF-02 eligibility', () => {
  it.each([
    ['no orders', []],
    ['pending only', [{ plan_id: 7, status: 0 }]],
    ['cancelled only', [{ plan_id: 7, status: 2 }]],
    [
      'deposit only',
      [
        { plan_id: 0, status: 1 },
        { plan_id: 0, status: 3 },
        { plan_id: 0, status: 4 },
      ],
    ],
  ])('blocks entry discovery for %s before its upstream endpoint', async (_case, data) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data }));

    await expect(
      createAdapter(fetcher).subscriptionEntries('opaque-auth')
    ).rejects.toBeInstanceOf(V2BoardSubscriptionAccessUnavailableError);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://private.example/api/v1/user/order/fetch'
    );
  });

  it.each([
    ['no orders', []],
    ['pending only', [{ plan_id: 7, status: 0 }]],
    ['cancelled only', [{ plan_id: 7, status: 2 }]],
    ['deposit only', [{ plan_id: 0, status: 3 }]],
  ])('blocks selected entry access for %s before its upstream endpoint', async (_case, data) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data }));

    await expect(
      createAdapter(fetcher).subscriptionEntryAccess(
        'opaque-auth',
        'https://selected.example/p'
      )
    ).rejects.toBeInstanceOf(V2BoardSubscriptionAccessUnavailableError);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://private.example/api/v1/user/order/fetch'
    );
  });

  it.each([1, 3, 4])(
    'allows the unchanged CF-01 qualifying status %s',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ data: [{ plan_id: 7, status }] })
        )
        .mockResolvedValueOnce(jsonResponse({ data: { entries: [] } }));

      await expect(
        createAdapter(fetcher).subscriptionEntries('opaque-auth')
      ).resolves.toEqual([]);
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        'https://private.example/api/v1/user/order/fetch',
        'https://private.example/api/v1/user/getSubscribeEntries',
      ]);
    }
  );
});

describe('V2BoardSubscriptionAdapter CF-02 entry discovery', () => {
  it.each([
    ['empty', []],
    ['single', [{ base_url: 'https://a.example.com' }]],
    [
      'multiple ordered path/port/trailing-slash entries',
      [
        { base_url: 'https://a.example.com' },
        { base_url: 'https://b.example.com/p' },
        { base_url: 'https://c.example.com:8443/' },
      ],
    ],
  ])('maps %s entries without sorting or relabeling', async (_case, entries) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { entries, internal: 'must-not-leak' },
          config: 'must-not-leak',
        })
      );

    await expect(
      createAdapter(fetcher).subscriptionEntries('opaque-auth')
    ).resolves.toEqual(
      entries.map(({ base_url }) => ({ baseUrl: base_url }))
    );
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://private.example/api/v1/user/order/fetch',
      'https://private.example/api/v1/user/getSubscribeEntries',
    ]);
  });

  it.each([
    {},
    { data: null },
    { data: {} },
    { data: { entries: 'not-an-array' } },
    { data: { entries: [{ base_url: 7 }] } },
    { data: { entries: [{ base_url: 'x'.repeat(2049) }] } },
    {
      data: {
        entries: Array.from({ length: 101 }, (_, index) => ({
          base_url: `https://${index}.example.com`,
        })),
      },
    },
  ])('fails closed on malformed or pathological entry payload %#', async (payload) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
      .mockResolvedValueOnce(jsonResponse(payload));

    await expect(
      createAdapter(fetcher).subscriptionEntries('opaque-auth')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([401, 403])(
    'maps entry-discovery upstream auth status %s through shared auth handling',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
        .mockResolvedValueOnce(jsonResponse({ message: 'private' }, status));

      await expect(
        createAdapter(fetcher).subscriptionEntries('opaque-auth')
      ).rejects.toBeInstanceOf(V2BoardAuthenticationError);
    }
  );

  it.each([
    ['invalid JSON', new Response('{')],
    ['HTML error', new Response('<html>private</html>', { status: 500 })],
  ])('normalizes %s from entry discovery', async (_case, response) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
      .mockResolvedValueOnce(response);

    await expect(
      createAdapter(fetcher).subscriptionEntries('opaque-auth')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([
    [new Error('network failure'), V2BoardUpstreamError],
    [new DOMException('timed out', 'TimeoutError'), V2BoardTimeoutError],
  ])('normalizes entry-discovery transport failures', async (failure, ErrorType) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
      .mockRejectedValueOnce(failure);

    await expect(
      createAdapter(fetcher).subscriptionEntries('opaque-auth')
    ).rejects.toBeInstanceOf(ErrorType);
  });
});

describe('V2BoardSubscriptionAdapter CF-02 selected entry access', () => {
  it.each([
    ['A', 'https://a.example.com'],
    ['B', 'https://b.example.com/p'],
    ['C', 'https://c.example.com:8443/'],
  ])('forwards selected entry %s literally to only the fixed V2Board endpoint', async (_label, baseUrl) => {
    const accessUrl = `${baseUrl}/api/v1/client/subscribe?token=opaque_${_label}`;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { subscribe_url: accessUrl, token: 'must-not-leak' },
          user: 'must-not-leak',
        })
      );

    await expect(
      createAdapter(fetcher).subscriptionEntryAccess('opaque-auth', baseUrl)
    ).resolves.toBe(accessUrl);

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://private.example/api/v1/user/order/fetch',
      'https://private.example/api/v1/user/getSubscribeForEntry',
    ]);
    const init = fetcher.mock.calls[1][1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ base_url: baseUrl }));
    expect(init?.redirect).toBe('manual');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('opaque-auth');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('preserves prefix-overlap selection and the generated opaque URL unchanged', async () => {
    const selected = 'https://x.example.com/p';
    const accessUrl =
      'https://x.example.com/p/api/v1/client/subscribe?token=OTP_secret&mode=one-time';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
      .mockResolvedValueOnce(
        jsonResponse({ data: { subscribe_url: accessUrl } })
      );

    await expect(
      createAdapter(fetcher).subscriptionEntryAccess('opaque-auth', selected)
    ).resolves.toBe(accessUrl);
    expect(fetcher.mock.calls[1][1]?.body).toBe(
      JSON.stringify({ base_url: selected })
    );
  });

  it.each([401, 403])(
    'maps selected-entry upstream auth status %s through shared auth handling',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
        .mockResolvedValueOnce(jsonResponse({ message: 'private' }, status));

      await expect(
        createAdapter(fetcher).subscriptionEntryAccess(
          'opaque-auth',
          'https://a.example.com'
        )
      ).rejects.toBeInstanceOf(V2BoardAuthenticationError);
    }
  );

  it('maps only the official stale selection response to the neutral entry error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
      .mockResolvedValueOnce(
        jsonResponse(
          { message: 'Selected subscription entry is invalid' },
          422
        )
      );

    await expect(
      createAdapter(fetcher).subscriptionEntryAccess(
        'opaque-auth',
        'https://stale.example.com'
      )
    ).rejects.toBeInstanceOf(V2BoardSubscriptionEntryUnavailableError);
  });

  it.each([
    [422, { message: 'Different validation failure' }],
    [500, { message: 'Subscription entry configuration is invalid' }],
    [500, { message: 'private database detail' }],
  ])('fails closed on upstream HTTP %s payload %#', async (status, payload) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
      .mockResolvedValueOnce(jsonResponse(payload, status));

    await expect(
      createAdapter(fetcher).subscriptionEntryAccess(
        'opaque-auth',
        'https://a.example.com'
      )
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([
    ['malformed JSON', new Response('{', { status: 200 })],
    ['HTML', new Response('<html>private</html>', { status: 500 })],
    ['missing data', jsonResponse({})],
    ['missing subscribe_url', jsonResponse({ data: {} })],
    [
      'oversized subscribe_url',
      jsonResponse({ data: { subscribe_url: 'x'.repeat(8193) } }),
    ],
  ])('fails closed on %s without credential recovery', async (_case, response) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
      .mockResolvedValueOnce(response);

    await expect(
      createAdapter(fetcher).subscriptionEntryAccess(
        'opaque-auth',
        'https://a.example.com'
      )
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [new Error('network secret https://selected.example/p'), V2BoardUpstreamError],
    [
      new DOMException('timeout token=secret', 'TimeoutError'),
      V2BoardTimeoutError,
    ],
  ])('normalizes transport failure without logging sensitive URLs', async (failure, ErrorType) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(qualifyingHistory))
      .mockRejectedValueOnce(failure);

    await expect(
      createAdapter(fetcher).subscriptionEntryAccess(
        'opaque-auth',
        'https://selected.example/p'
      )
    ).rejects.toBeInstanceOf(ErrorType);
    const logged = JSON.stringify([...error.mock.calls, ...log.mock.calls]);
    expect(logged).not.toContain('selected.example');
    expect(logged).not.toContain('token=secret');
    expect(logged).not.toContain('opaque-auth');
  });
});
