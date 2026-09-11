import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UpstreamRedirectError,
  V2BoardClient,
} from '../src/adapters/v2board/client';

function responseWithCancellableBody(
  status: number,
  cancel: (reason: unknown) => void | Promise<void>
): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('unused upstream body'));
      },
      cancel,
    }),
    {
      status,
      headers: { Location: 'https://private.example/login' },
    }
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('V2BoardClient', () => {
  it('forces manual redirects and forwards only explicitly allowed headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const client = new V2BoardClient(
      {
        baseUrl: 'https://private.example/internal/',
        accessClientId: 'service-id',
        accessClientSecret: 'service-secret',
      },
      fetcher
    );

    await client.fetch('user/info', {
      redirect: 'follow',
      headers: {
        Accept: 'application/json',
        Authorization: 'opaque-credential',
        'Content-Type': 'application/json',
        Cookie: 'session=attacker',
        Host: 'attacker.example',
        'User-Agent': 'attacker-controlled',
        'CF-Connecting-IP': '203.0.113.1',
        'CF-Access-Client-Id': 'attacker-id',
        'CF-Access-Client-Secret': 'attacker-secret',
        'X-Forwarded-For': '203.0.113.1',
      },
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    const headers = new Headers(init?.headers);

    expect(url).toBe('https://private.example/internal/user/info');
    expect(init?.redirect).toBe('manual');
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('authorization')).toBe('opaque-credential');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('cf-access-client-id')).toBe('service-id');
    expect(headers.get('cf-access-client-secret')).toBe('service-secret');
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('host')).toBe(false);
    expect(headers.has('user-agent')).toBe(false);
    expect(headers.has('cf-connecting-ip')).toBe(false);
    expect(headers.has('x-forwarded-for')).toBe(false);
  });

  it('forwards User-Agent only through the explicit trusted channel', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const client = new V2BoardClient(
      { baseUrl: 'https://private.example/internal/' },
      fetcher
    );

    await client.fetch('user/order/checkout', {
      trustedUserAgent: 'Mozilla/5.0 (iPhone; Mobile)',
    });

    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get('user-agent')).toBe('Mozilla/5.0 (iPhone; Mobile)');
  });

  it.each([
    ['oversized', 'a'.repeat(513)],
    ['oversized UTF-8', '界'.repeat(171)],
    ['CRLF', 'Mobile\r\nX-Attacker: injected'],
    ['control character', 'Mobile\u007fInjected'],
  ])('rejects an %s trusted User-Agent before fetch', async (_case, userAgent) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new V2BoardClient(
      { baseUrl: 'https://private.example/internal/' },
      fetcher
    );

    await expect(
      client.fetch('user/order/checkout', { trustedUserAgent: userAgent })
    ).rejects.toThrow('Invalid trusted User-Agent');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'https://attacker.example/collect',
    '//attacker.example/collect',
    '../outside-adapter-root',
  ])('rejects a path that can escape the configured adapter root: %s', async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new V2BoardClient(
      { baseUrl: 'https://private.example/internal/' },
      fetcher
    );

    await expect(client.fetch(path)).rejects.toThrow('Invalid upstream path');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed on an upstream redirect', async () => {
    const cancel = vi.fn();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(responseWithCancellableBody(302, cancel));
    const client = new V2BoardClient(
      { baseUrl: 'https://private.example/' },
      fetcher
    );

    await expect(client.fetch('user/info')).rejects.toBeInstanceOf(
      UpstreamRedirectError
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('preserves the redirect error when body cancellation fails', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('cancel failed'));
    const client = new V2BoardClient(
      { baseUrl: 'https://private.example/' },
      vi.fn<typeof fetch>().mockResolvedValue(
        responseWithCancellableBody(302, cancel)
      )
    );

    await expect(client.fetch('user/info')).rejects.toBeInstanceOf(
      UpstreamRedirectError
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects a non-HTTPS upstream origin', () => {
    expect(
      () => new V2BoardClient({ baseUrl: 'http://private.example/' })
    ).toThrow('Upstream base URL must use HTTPS');
  });

  it('aborts an outbound request after the configured timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () => new Promise((resolve) => {
        setTimeout(() => resolve(new Response('{}')), 50);
      })
    );
    const client = new V2BoardClient(
      { baseUrl: 'https://private.example/', timeoutMs: 10 },
      fetcher
    );

    const assertion = expect(client.fetch('user/info')).rejects.toThrow(
      'Upstream request timed out'
    );
    await vi.advanceTimersByTimeAsync(50);
    await assertion;

    const [, init] = fetcher.mock.calls[0];
    expect(init?.signal?.aborted).toBe(true);
  });

  it('uses a 10 second timeout by default', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () => new Promise((resolve) => {
        setTimeout(() => resolve(new Response('{}')), 10_001);
      })
    );
    const client = new V2BoardClient(
      { baseUrl: 'https://private.example/' },
      fetcher
    );

    const assertion = expect(client.fetch('user/info')).rejects.toThrow(
      'Upstream request timed out'
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });
});
