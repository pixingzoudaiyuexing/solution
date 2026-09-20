import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

const env = {
  V2BOARD_BASE_URL: 'https://private.example/api/v1/',
  V2BOARD_SUBSCRIBE_PATH: '/hidden-subscribe',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function request(
  path: string,
  init: RequestInit = {},
  authenticated = true
): Request {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set('Authorization', 'Bearer opaque-auth');
  headers.set('cf-ray', 'request-id');
  return new Request(`https://gateway.example${path}`, { ...init, headers });
}

const currentEntitlement = {
  data: { banned: 0, transfer_enable: 1024, expired_at: 253_402_300_799 },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/subscription/entries', () => {
  it('requires shared Bearer authorization without calling upstream', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request('/api/v1/subscription/entries', {}, false),
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['expired entitlement', { banned: 0, transfer_enable: 1024, expired_at: 1 }],
    ['banned account', { banned: 1, transfer_enable: 1024, expired_at: null }],
    ['zero allowance', { banned: 0, transfer_enable: 0, expired_at: null }],
  ])('returns unavailable for %s without discovering entries', async (_case, entitlement) => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: entitlement }));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request('/api/v1/subscription/entries'),
      env
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'SUBSCRIPTION_ACCESS_UNAVAILABLE' },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(upstreamFetch.mock.calls[0][0]).toBe(
      'https://private.example/api/v1/user/info'
    );
  });

  it('returns ordered normalized entries with no-store and no upstream fields', async () => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(currentEntitlement))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            entries: [
              { base_url: 'https://a.example.com', secret: 'drop-me' },
              { base_url: 'https://b.example.com/p', id: 2 },
            ],
          },
        })
      );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request('/api/v1/subscription/entries'),
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        entries: [
          { baseUrl: 'https://a.example.com' },
          { baseUrl: 'https://b.example.com/p' },
        ],
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['missing', undefined],
    ['invalid', '?bad'],
  ])(
    'does not depend on a %s legacy subscription path',
    async (_case, legacyPath) => {
      const upstreamFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(currentEntitlement))
        .mockResolvedValueOnce(
          jsonResponse({
            data: { entries: [{ base_url: 'https://a.example.com' }] },
          })
        );
      vi.stubGlobal('fetch', upstreamFetch);

      const response = await app.fetch(
        request('/api/v1/subscription/entries'),
        { ...env, V2BOARD_SUBSCRIBE_PATH: legacyPath }
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: { entries: [{ baseUrl: 'https://a.example.com' }] },
      });
      expect(upstreamFetch.mock.calls.map(([url]) => url)).toEqual([
        'https://private.example/api/v1/user/info',
        'https://private.example/api/v1/user/getSubscribeEntries',
      ]);
    }
  );
});

describe('POST /api/v1/subscription/entry-access', () => {
  it('requires shared Bearer authorization without reading the body upstream', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request(
        '/api/v1/subscription/entry-access',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl: 'https://a.example.com' }),
        },
        false
      ),
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid JSON', '{'],
    ['missing baseUrl', JSON.stringify({})],
    ['empty baseUrl', JSON.stringify({ baseUrl: '' })],
    ['whitespace baseUrl', JSON.stringify({ baseUrl: '   ' })],
    ['wrong type', JSON.stringify({ baseUrl: 7 })],
    [
      'extra field',
      JSON.stringify({ baseUrl: 'https://a.example.com', fallback: true }),
    ],
    ['oversized baseUrl', JSON.stringify({ baseUrl: 'x'.repeat(2049) })],
  ])('rejects strict request shape: %s', async (_case, body) => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request('/api/v1/subscription/entry-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      env
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('returns CF-01 unavailable before selected-entry generation', async () => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ data: { banned: 0, transfer_enable: 0, expired_at: null } })
      );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request('/api/v1/subscription/entry-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'https://a.example.com' }),
      }),
      env
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'SUBSCRIPTION_ACCESS_UNAVAILABLE' },
    });
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it('returns the complete V2Board-generated access URL unchanged', async () => {
    const baseUrl = 'https://x.example.com/p';
    const accessUrl =
      'https://x.example.com/p/api/v1/client/subscribe?token=opaque_secret&mode=otp';
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(currentEntitlement))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { subscribe_url: accessUrl, uuid: 'must-not-leak' },
          merchant: 'must-not-leak',
        })
      );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request('/api/v1/subscription/entry-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Host: 'attacker.example',
          'X-Forwarded-Host': 'attacker.example',
        },
        body: JSON.stringify({ baseUrl }),
      }),
      env
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      data: { accessUrl },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(text).not.toContain('must-not-leak');
    expect(upstreamFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://private.example/api/v1/user/info',
      'https://private.example/api/v1/user/getSubscribeForEntry',
    ]);
    expect(upstreamFetch.mock.calls[1][1]?.body).toBe(
      JSON.stringify({ base_url: baseUrl })
    );
  });

  it.each([
    ['missing', undefined],
    ['invalid', '//bad'],
  ])(
    'does not depend on a %s legacy subscription path',
    async (_case, legacyPath) => {
      const baseUrl = 'https://a.example.com';
      const accessUrl = `${baseUrl}/api/v1/client/subscribe?token=opaque`;
      const upstreamFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(currentEntitlement))
        .mockResolvedValueOnce(
          jsonResponse({ data: { subscribe_url: accessUrl } })
        );
      vi.stubGlobal('fetch', upstreamFetch);

      const response = await app.fetch(
        request('/api/v1/subscription/entry-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl }),
        }),
        { ...env, V2BOARD_SUBSCRIBE_PATH: legacyPath }
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ data: { accessUrl } });
      expect(upstreamFetch.mock.calls.map(([url]) => url)).toEqual([
        'https://private.example/api/v1/user/info',
        'https://private.example/api/v1/user/getSubscribeForEntry',
      ]);
    }
  );

  it.each([401, 403])('maps upstream auth status %s to AUTH_FAILED', async (status) => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(currentEntitlement))
      .mockResolvedValueOnce(jsonResponse({ message: 'private' }, status));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request('/api/v1/subscription/entry-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'https://a.example.com' }),
      }),
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_FAILED' },
    });
  });

  it('maps stale selection to neutral 422 without echoing the submitted URL', async () => {
    const selected = 'https://stale-secret.example/p';
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(currentEntitlement))
      .mockResolvedValueOnce(
        jsonResponse(
          { message: 'Selected subscription entry is invalid' },
          422
        )
      );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request('/api/v1/subscription/entry-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: selected }),
      }),
      env
    );
    const text = await response.text();

    expect(response.status).toBe(422);
    expect(JSON.parse(text)).toMatchObject({
      error: {
        code: 'SUBSCRIPTION_ENTRY_UNAVAILABLE',
        message: 'Selected subscription entry is unavailable',
      },
    });
    expect(text).not.toContain(selected);
  });

  it.each([
    [
      'invalid V2Board entry configuration',
      jsonResponse(
        { message: 'Subscription entry configuration is invalid' },
        500
      ),
      502,
      'UPSTREAM_ERROR',
    ],
    ['malformed JSON', new Response('{'), 502, 'UPSTREAM_ERROR'],
  ])('normalizes %s', async (_case, upstreamResponse, status, code) => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(currentEntitlement))
      .mockResolvedValueOnce(upstreamResponse);
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request('/api/v1/subscription/entry-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: 'https://a.example.com' }),
      }),
      env
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it('normalizes timeout and never logs the submitted or returned credential URL', async () => {
    const selected = 'https://selected-secret.example/p';
    const credential = 'https://selected-secret.example/p/sub?token=credential';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(currentEntitlement))
      .mockRejectedValueOnce(
        new DOMException(`timeout ${credential}`, 'TimeoutError')
      );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      request('/api/v1/subscription/entry-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: selected }),
      }),
      env
    );
    const text = await response.text();

    expect(response.status).toBe(504);
    expect(text).toContain('UPSTREAM_TIMEOUT');
    expect(text).not.toContain(selected);
    expect(text).not.toContain(credential);
    const logged = JSON.stringify([...error.mock.calls, ...log.mock.calls]);
    expect(logged).not.toContain(selected);
    expect(logged).not.toContain(credential);
    expect(logged).not.toContain('opaque-auth');
  });
});
