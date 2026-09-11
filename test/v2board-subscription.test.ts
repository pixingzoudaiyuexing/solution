import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardSubscriptionUnavailableError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardSubscriptionAdapter } from '../src/adapters/v2board/subscription';
import {
  extractSubscriptionToken,
  normalizeV2BoardSubscribePath,
  validateGatewayPublicOrigin,
  validateSubscriptionToken,
} from '../src/security/subscription';

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

describe('V2BoardSubscriptionAdapter metadata', () => {
  it.each([1, 3, 4])(
    'treats subscription order status %s as previously purchased',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              {
                plan_id: 7,
                status,
                callback_no: 'private-callback',
                payment_id: 3,
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              subscribe_url:
                'https://subscription.example/client?token=normal_token-123',
              token: 'raw-user-token',
              uuid: 'private-uuid',
            },
          })
        );

      await expect(
        createAdapter(fetcher).subscriptionAccess('opaque-auth')
      ).resolves.toEqual({
        eligible: true,
        token: 'normal_token-123',
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

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
  ])('does not request a subscription credential for %s', async (_case, data) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data }));

    await expect(
      createAdapter(fetcher).subscriptionAccess('opaque-auth')
    ).resolves.toEqual({ eligible: false });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://private.example/api/v1/user/order/fetch'
    );
  });

  it('fails closed on malformed order history without requesting credentials', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: [{ plan_id: 7, status: '3' }] }));

    await expect(
      createAdapter(fetcher).subscriptionAccess('opaque-auth')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('fails closed on a malformed generated subscription URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ plan_id: 7, status: 3 }] })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            subscribe_url:
              'https://private.example/subscribe?token=valid&internal=leak',
            token: 'raw-user-token',
          },
        })
      );

    await expect(
      createAdapter(fetcher).subscriptionAccess('opaque-auth')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([
    [
      'normal',
      '0123456789abcdef0123456789abcdef',
      'https://sub.example/s?token=0123456789abcdef0123456789abcdef',
    ],
    [
      'OTP',
      'AbCdEfGhIjKlMnOpQrStUvWxYz_012-3',
      'https://sub.example/s?token=AbCdEfGhIjKlMnOpQrStUvWxYz_012-3',
    ],
    [
      'time-based',
      'MTIzOjAxMjM0NTY3ODlhYmNkZWZfLQ',
      'http://private-sub.example/s?token=MTIzOjAxMjM0NTY3ODlhYmNkZWZfLQ',
    ],
  ])('preserves the %s token mode exactly', (_mode, token, url) => {
    expect(extractSubscriptionToken(url)).toBe(token);
  });

  it.each([
    'not-a-url',
    ' https://sub.example/s?token=abc',
    'https://sub.example/s?token=abc\n',
    'javascript:alert(1)?token=abc',
    'https://sub.example/s',
    'https://sub.example/s?token=',
    'https://sub.example/s?token=abc&token=def',
    'https://sub.example/s?token=abc&flag=clash',
    'https://sub.example/s?token=abc#fragment',
    'https://user:password@sub.example/s?token=abc',
    'https://sub.example/s?token=abc%2Fdef',
  ])('rejects malformed upstream subscription URL %s', (url) => {
    expect(() => extractSubscriptionToken(url)).toThrow(
      'Invalid upstream subscription URL'
    );
  });

  it.each([
    '',
    'contains.dot',
    'contains/slash',
    'contains space',
    'a'.repeat(513),
    'line\nbreak',
  ])('rejects invalid subscription token %s', (token) => {
    expect(() => validateSubscriptionToken(token)).toThrow(
      'Invalid subscription token'
    );
  });

  it.each([
    '',
    'api/v1/client/subscribe',
    '//attacker.example/subscribe',
    'https://attacker.example/subscribe',
    '/safe/../admin',
    '/safe\\admin',
    '/safe?path=other',
    '/safe#fragment',
    '/safe/%2e%2e/admin',
  ])('rejects unsafe fixed subscribe path %s', (path) => {
    expect(() => normalizeV2BoardSubscribePath(path)).toThrow(
      'Invalid V2Board subscription path'
    );
  });

  it('normalizes one fixed V2Board path for the root client', () => {
    expect(normalizeV2BoardSubscribePath('/client/subscribe-v1')).toBe(
      'client/subscribe-v1'
    );
  });

  it('derives the public origin from a validated Gateway request URL', () => {
    expect(
      validateGatewayPublicOrigin(
        'https://gateway.example/api/v1/subscription',
        'https://private.example/api/v1/'
      )
    ).toBe('https://gateway.example');
  });

  it.each([
    'http://gateway.example/api/v1/subscription',
    'https://localhost/api/v1/subscription',
    'https://127.0.0.1/api/v1/subscription',
    'https://private.example/api/v1/subscription',
    'https://user:password@gateway.example/api/v1/subscription',
  ])('rejects unsafe Gateway request URL %s', (requestUrl) => {
    expect(() =>
      validateGatewayPublicOrigin(
        requestUrl,
        'https://private.example/api/v1/'
      )
    ).toThrow('Invalid Gateway public origin');
  });
});

describe('V2BoardSubscriptionAdapter streaming', () => {
  it('returns the untouched body stream and strict headers', async () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        statusText: 'Private Upstream Detail',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="subscription.txt"',
          'subscription-userinfo': 'upload=1; download=2; total=3; expire=4',
          'profile-update-interval': '24',
          'profile-title': 'base64:VGVzdA==',
          'profile-web-page-url': 'https://private.example/dashboard',
          'Set-Cookie': 'secret=session',
          Server: 'nginx',
          'X-Powered-By': 'PHP',
          'X-V2Board-Internal': 'private',
        },
      })
    );

    const response = await createAdapter(fetcher).subscriptionContent(
      'opaque_token-123',
      'Clash.Meta/1.0'
    );

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toContain(
      'subscription.txt'
    );
    expect(response.headers.get('subscription-userinfo')).toContain('total=3');
    expect(response.headers.get('profile-update-interval')).toBe('24');
    expect(response.headers.get('profile-title')).toBe('base64:VGVzdA==');
    expect(response.headers.has('profile-web-page-url')).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(response.headers.has('server')).toBe(false);
    expect(response.headers.has('x-powered-by')).toBe(false);
    expect(response.headers.has('x-v2board-internal')).toBe(false);
    expect(response.statusText).not.toContain('Private Upstream Detail');

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://private.example/hidden-subscribe?token=opaque_token-123'
    );
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('user-agent')).toBe('Clash.Meta/1.0');
  });

  it('preserves an upstream successful empty body', async () => {
    const response = await createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    ).subscriptionContent('opaque_token-123');

    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it('normalizes unavailable credentials without reading the body', async () => {
    const response = new Response('<h1>token is error</h1>', { status: 403 });
    const text = vi.spyOn(response, 'text');
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(response)
    );

    await expect(
      adapter.subscriptionContent('opaque_token-123')
    ).rejects.toBeInstanceOf(V2BoardSubscriptionUnavailableError);
    expect(text).not.toHaveBeenCalled();
  });

  it('normalizes upstream failures and timeouts', async () => {
    const failed = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>Laravel error</h1>', { status: 500 })
      )
    );
    const timedOut = createAdapter(
      vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('The operation timed out', 'TimeoutError')
      )
    );

    await expect(
      failed.subscriptionContent('opaque_token-123')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timedOut.subscriptionContent('opaque_token-123')
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });
});
