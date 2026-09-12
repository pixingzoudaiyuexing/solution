import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  FRONTEND_ORIGINS: 'https://client.example',
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authorization() {
  return { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/config/onboarding', () => {
  it('is public and returns only onboarding requirement discovery', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          tos_url: 'https://legal.example/terms',
          is_email_verify: 1,
          is_invite_force: 0,
          email_whitelist_suffix: ['example.com'],
          is_recaptcha: 1,
          recaptcha_site_key: 'public-site-key',
          app_description: 'private description',
          app_url: 'https://backend.example',
          logo: 'https://backend.example/logo.png',
        },
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/config/onboarding',
      { headers: { 'cf-ray': 'request-id' } },
      env
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        termsUrl: 'https://legal.example/terms',
        emailVerificationRequired: true,
        inviteCodeRequired: false,
        emailSuffixWhitelist: ['example.com'],
        antiBot: {
          enabled: true,
          provider: 'recaptcha',
          mode: 'v2-checkbox',
          siteKey: 'public-site-key',
        },
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/guest/comm/config'
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('app_description');
    expect(serialized).not.toContain('app_url');
    expect(serialized).not.toContain('logo');
    expect(serialized).not.toContain('backend.example');
    expect(serialized).not.toContain('registrationOpen');
  });

  it('normalizes malformed and timeout responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: null }))
    );
    let response = await app.request('/api/v1/config/onboarding', undefined, env);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });

    const timeoutFetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', timeoutFetcher);
    response = await app.request('/api/v1/config/onboarding', undefined, env);
    expect(response.status).toBe(504);
    expect(timeoutFetcher).toHaveBeenCalledOnce();
  });
});

describe('GET /api/v1/config/account', () => {
  it('requires authorization before any upstream request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request('/api/v1/config/account', undefined, env);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns only currency through one user config request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          currency: 'CNY',
          currency_symbol: '¥',
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
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/config/account',
      { headers: authorization() },
      env
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: { currency: 'CNY', currencySymbol: '¥' },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/comm/config'
    );
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      'telegram',
      'stripe',
      'withdraw',
      'commission_distribution',
      'opaque-token',
      'backend.example',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('maps invalid auth and malformed upstream data safely', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );
    let response = await app.request(
      '/api/v1/config/account',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_FAILED' } });

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: { currency: 'CNY', currency_symbol: null } })
      )
    );
    response = await app.request(
      '/api/v1/config/account',
      { headers: authorization() },
      env
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });
});
