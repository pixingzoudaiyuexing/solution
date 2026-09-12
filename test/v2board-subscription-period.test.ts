import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardAuthenticationError,
  V2BoardSubscriptionPeriodAdvanceDisabledError,
  V2BoardSubscriptionPeriodAdvanceError,
  V2BoardSubscriptionPeriodAdvanceUnavailableError,
  V2BoardSubscriptionTrafficNotExhaustedError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardSubscriptionPeriodAdapter } from '../src/adapters/v2board/subscription-period';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardSubscriptionPeriodAdapter {
  return new V2BoardSubscriptionPeriodAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

describe('V2BoardSubscriptionPeriodAdapter', () => {
  it('posts once without a body and returns only advanced=true', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: true,
        expired_at: 1893456000,
        u: 0,
        d: 0,
        reset_day: 30,
      })
    );

    await expect(
      createAdapter(fetcher).advance('opaque-token')
    ).resolves.toEqual({ advanced: true });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/newPeriod');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it.each([
    ['Renewal is not allowed', V2BoardSubscriptionPeriodAdvanceDisabledError],
    [
      'You have not used up your traffic, you cannot renew your subscription',
      V2BoardSubscriptionTrafficNotExhaustedError,
    ],
    [
      'You do not allow to renew the subscription',
      V2BoardSubscriptionPeriodAdvanceUnavailableError,
    ],
    [
      'You do not have enough time to renew your subscription',
      V2BoardSubscriptionPeriodAdvanceUnavailableError,
    ],
    ['Save failed', V2BoardSubscriptionPeriodAdvanceError],
    ['保存失败', V2BoardSubscriptionPeriodAdvanceError],
  ])('maps confirmed exact error %s', async (message, ErrorType) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    await expect(adapter.advance('opaque-token')).rejects.toBeInstanceOf(
      ErrorType
    );
  });

  it.each([
    'Invalid reset period',
    'The user does not exist',
    '该用户不存在',
    'Renewal is not allowed with details',
    'Unknown period failure',
  ])('keeps configuration and unknown errors generic: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    await expect(adapter.advance('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it.each([
    { data: false },
    { data: null },
    {},
    { data: 'true' },
    { data: {} },
    [],
  ])('fails closed on malformed success %#', async (payload) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );

    await expect(adapter.advance('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes auth, invalid JSON, HTML, unknown failure, and timeout without retry', async () => {
    const auth = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: 'Session expired' }, 403)
    );
    await expect(createAdapter(auth).advance('opaque-token')).rejects.toBeInstanceOf(
      V2BoardAuthenticationError
    );
    expect(auth).toHaveBeenCalledOnce();

    for (const response of [
      new Response('{invalid', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response('<h1>private Laravel failure</h1>', { status: 500 }),
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        createAdapter(fetcher).advance('opaque-token')
      ).rejects.toBeInstanceOf(V2BoardUpstreamError);
      expect(fetcher).toHaveBeenCalledOnce();
    }

    const unknown = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: 'Database period failure' }, 500)
    );
    await expect(
      createAdapter(unknown).advance('opaque-token')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    expect(unknown).toHaveBeenCalledOnce();

    const timeout = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    await expect(
      createAdapter(timeout).advance('opaque-token')
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
    expect(timeout).toHaveBeenCalledOnce();
  });
});
