import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';

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
    expect(headers.has('cf-connecting-ip')).toBe(false);
    expect(headers.has('x-forwarded-for')).toBe(false);
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
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://private.example/login' },
      })
    );
    const client = new V2BoardClient(
      { baseUrl: 'https://private.example/' },
      fetcher
    );

    await expect(client.fetch('user/info')).rejects.toThrow('Upstream redirect rejected');
  });

  it('rejects a non-HTTPS upstream origin', () => {
    expect(
      () => new V2BoardClient({ baseUrl: 'http://private.example/' })
    ).toThrow('Upstream base URL must use HTTPS');
  });
});
