import { describe, expect, it, vi } from 'vitest';
import { V2BoardConfigAdapter } from '../src/adapters/v2board/config';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardAuthenticationError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(fetcher: typeof fetch): V2BoardClient {
  return new V2BoardClient(
    { baseUrl: 'https://backend.example/api/v1/' },
    fetcher
  );
}

function guestConfig(overrides: Record<string, unknown> = {}) {
  return {
    tos_url: 'https://legal.example/terms',
    is_email_verify: 1,
    is_invite_force: 1,
    email_whitelist_suffix: [' @example.com ', 'qq.com'],
    is_recaptcha: 1,
    recaptcha_site_key: 'public-site-key',
    app_description: 'private description',
    app_url: 'https://backend.example',
    logo: 'https://backend.example/logo.png',
    ...overrides,
  };
}

describe('V2BoardConfigAdapter onboarding config', () => {
  it('maps enabled requirements and strips unrelated guest config', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: guestConfig() }));
    const adapter = new V2BoardConfigAdapter(client(fetcher));

    await expect(adapter.onboardingConfig()).resolves.toEqual({
      termsUrl: 'https://legal.example/terms',
      emailVerificationRequired: true,
      inviteCodeRequired: true,
      emailSuffixWhitelist: ['@example.com', 'qq.com'],
      antiBot: {
        enabled: true,
        provider: 'recaptcha',
        mode: 'v2-checkbox',
        siteKey: 'public-site-key',
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/guest/comm/config');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });

  it('normalizes disabled optional requirements without leaking a residual site key', async () => {
    const adapter = new V2BoardConfigAdapter(
      client(
        vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({
            data: guestConfig({
              tos_url: '   ',
              is_email_verify: 0,
              is_invite_force: 0,
              email_whitelist_suffix: 0,
              is_recaptcha: 0,
              recaptcha_site_key: 'stale-public-key',
            }),
          })
        )
      )
    );

    await expect(adapter.onboardingConfig()).resolves.toEqual({
      termsUrl: null,
      emailVerificationRequired: false,
      inviteCodeRequired: false,
      emailSuffixWhitelist: null,
      antiBot: { enabled: false, provider: null, mode: null, siteKey: null },
    });
  });

  it.each(['http://legal.example/terms', 'https://legal.example/terms'])(
    'allows a public terms URL using %s',
    async (url) => {
      const adapter = new V2BoardConfigAdapter(
        client(
          vi.fn<typeof fetch>().mockResolvedValue(
            jsonResponse({ data: guestConfig({ tos_url: url }) })
          )
        )
      );

      await expect(adapter.onboardingConfig()).resolves.toMatchObject({
        termsUrl: url,
      });
    }
  );

  it.each([
    ['invalid terms scheme', { tos_url: 'javascript:alert(1)' }],
    ['data terms scheme', { tos_url: 'data:text/plain,terms' }],
    ['file terms scheme', { tos_url: 'file:///private/terms' }],
    ['invalid email flag', { is_email_verify: true }],
    ['invalid invite flag', { is_invite_force: '1' }],
    ['wrong whitelist type', { email_whitelist_suffix: 'example.com' }],
    ['empty whitelist item', { email_whitelist_suffix: ['   '] }],
    ['oversized whitelist item', { email_whitelist_suffix: ['x'.repeat(256)] }],
    ['enabled captcha missing key', { recaptcha_site_key: null }],
    ['enabled captcha empty key', { recaptcha_site_key: '   ' }],
    ['invalid site key type', { recaptcha_site_key: 7 }],
  ])('fails closed on malformed guest config: %s', async (_case, overrides) => {
    const adapter = new V2BoardConfigAdapter(
      client(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(jsonResponse({ data: guestConfig(overrides) }))
      )
    );

    await expect(adapter.onboardingConfig()).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('fails closed when enabled anti-bot config omits its site key', async () => {
    const data = (({ recaptcha_site_key: _siteKey, ...config }) => config)(
      guestConfig()
    );
    const adapter = new V2BoardConfigAdapter(
      client(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data })))
    );

    await expect(adapter.onboardingConfig()).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it.each([
    ['missing data', jsonResponse({})],
    ['HTML', new Response('<h1>private config failure</h1>', { status: 500 })],
    [
      'invalid JSON',
      new Response('{"data":', {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    ],
  ])('fails closed on %s', async (_case, response) => {
    const adapter = new V2BoardConfigAdapter(
      client(vi.fn<typeof fetch>().mockResolvedValue(response))
    );

    await expect(adapter.onboardingConfig()).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes timeout without retrying', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const adapter = new V2BoardConfigAdapter(client(fetcher));

    await expect(adapter.onboardingConfig()).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('V2BoardConfigAdapter account config', () => {
  it('maps only currency fields through one authenticated request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          currency: ' CNY ',
          currency_symbol: ' ¥ ',
          is_telegram: 1,
          telegram_discuss_link: 'https://t.me/private',
          stripe_pk: 'pk_live_private',
          withdraw_methods: ['USDT'],
          withdraw_close: 0,
          commission_distribution_enable: 1,
          commission_distribution_l1: 50,
          commission_distribution_l2: 30,
          commission_distribution_l3: 20,
        },
      })
    );
    const adapter = new V2BoardConfigAdapter(client(fetcher));

    await expect(adapter.accountConfig('opaque-token')).resolves.toEqual({
      currency: 'CNY',
      currencySymbol: '¥',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/comm/config');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it.each([
    ['missing currency', { currency_symbol: '¥' }],
    ['empty currency', { currency: ' ', currency_symbol: '¥' }],
    ['oversized currency', { currency: 'X'.repeat(17), currency_symbol: '¥' }],
    ['numeric currency', { currency: 1, currency_symbol: '¥' }],
    ['missing symbol', { currency: 'CNY' }],
    ['empty symbol', { currency: 'CNY', currency_symbol: ' ' }],
    ['oversized symbol', { currency: 'CNY', currency_symbol: 'x'.repeat(17) }],
    ['numeric symbol', { currency: 'CNY', currency_symbol: 1 }],
  ])('fails closed on malformed account config: %s', async (_case, data) => {
    const adapter = new V2BoardConfigAdapter(
      client(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data })))
    );

    await expect(adapter.accountConfig('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes authentication failure and timeout', async () => {
    const rejected = new V2BoardConfigAdapter(
      client(
        vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({ message: 'Session expired' }, 403)
        )
      )
    );
    const timeoutFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const timeout = new V2BoardConfigAdapter(client(timeoutFetcher));

    await expect(rejected.accountConfig('invalid-token')).rejects.toBeInstanceOf(
      V2BoardAuthenticationError
    );
    await expect(timeout.accountConfig('opaque-token')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
    expect(timeoutFetcher).toHaveBeenCalledOnce();
  });
});
