import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  FRONTEND_ORIGINS: 'https://client.example',
  V2BOARD_BASE_URL: 'https://private.example/api/v1/',
  V2BOARD_SUBSCRIBE_PATH: '/hidden-subscribe',
  V2BOARD_ACCESS_CLIENT_ID: 'access-client-id',
  V2BOARD_ACCESS_CLIENT_SECRET: 'access-client-secret',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function subscriptionRequest(headers: HeadersInit = {}): Request {
  return new Request('https://gateway.example/api/v1/subscription', {
    headers: {
      Authorization: 'Bearer opaque-auth',
      'cf-ray': 'request-id',
      ...headers,
    },
  });
}

function responseWithCancellableBody(
  status: number,
  cancel: (reason: unknown) => void | Promise<void>
): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('private Laravel error'));
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/subscription', () => {
  it.each([
    ['fresh registration', []],
    ['pending order', [{ plan_id: 7, status: 0 }]],
    ['cancelled order', [{ plan_id: 7, status: 2 }]],
    ['deposit order', [{ plan_id: 0, status: 3 }]],
  ])('withholds access URL for %s', async (_case, orders) => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: orders }));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(subscriptionRequest(), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { eligible: false, accessUrl: null },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it.each([1, 3, 4])(
    'returns a solution URL for qualifying status %s',
    async (status) => {
      const token = `mode_token-${status}`;
      const upstreamFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({
            data: [{ plan_id: 7, status, internal: 'must-not-leak' }],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              subscribe_url: `https://private.example/hidden?token=${token}`,
              token: 'raw-user-token',
              uuid: 'private-uuid',
              expired_at: 1,
            },
          })
        );
      vi.stubGlobal('fetch', upstreamFetch);

      const response = await app.fetch(
        subscriptionRequest({
          Host: 'attacker.example',
          'X-Forwarded-Host': 'attacker.example',
          'X-Original-Host': 'attacker.example',
        }),
        env
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: { eligible: boolean; accessUrl: string | null };
      };
      expect(body).toEqual({
        ok: true,
        data: {
          eligible: true,
          accessUrl:
            `https://gateway.example/api/v1/access/subscription?token=${token}`,
        },
        requestId: 'request-id',
      });
      expect(Object.keys(body.data)).toEqual(['eligible', 'accessUrl']);
      expect(JSON.stringify(body)).not.toContain('raw-user-token');
      expect(JSON.stringify(body)).not.toContain('private-uuid');
      expect(JSON.stringify(body)).not.toContain('/hidden?');
      expect(upstreamFetch).toHaveBeenCalledTimes(2);
    }
  );

  it('requires the shared browser Authorization middleware', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      new Request('https://gateway.example/api/v1/subscription'),
      env
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('maps an upstream authentication rejection without leaking details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Private session detail' }, 403)
      )
    );

    const response = await app.fetch(subscriptionRequest(), env);

    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toContain('AUTH_FAILED');
    expect(body).not.toContain('Private session detail');
  });
});

describe('POST /api/v1/subscription/rotate-access', () => {
  function rotationRequest(method = 'POST'): Request {
    return new Request(
      'https://gateway.example/api/v1/subscription/rotate-access',
      {
        method,
        headers: {
          Authorization: 'Bearer opaque-auth',
          'cf-ray': 'request-id',
          Host: 'attacker.example',
          'X-Forwarded-Host': 'attacker.example',
        },
      }
    );
  }

  it.each([
    ['fresh registration', []],
    ['pending order', [{ plan_id: 7, status: 0 }]],
    ['cancelled order', [{ plan_id: 7, status: 2 }]],
    ['deposit order', [{ plan_id: 0, status: 3 }]],
  ])('rejects %s before resetSecurity', async (_case, orders) => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: orders }));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(rotationRequest(), env);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'SUBSCRIPTION_ACCESS_UNAVAILABLE' },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(upstreamFetch.mock.calls[0][0]).toBe(
      'https://private.example/api/v1/user/order/fetch'
    );
  });

  it.each([1, 3, 4])(
    'rotates status %s into a solution-owned URL with exactly two calls',
    async (status) => {
      const token = `ROTATED_SECRET_TOKEN_${status}`;
      const upstreamFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({ data: [{ plan_id: 7, status }] })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: `https://v2board-hidden.example/raw/subscribe?token=${token}`,
            uuid: 'private-uuid',
          })
        );
      vi.stubGlobal('fetch', upstreamFetch);

      const response = await app.fetch(rotationRequest(), env);
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(JSON.parse(text)).toEqual({
        ok: true,
        data: {
          rotated: true,
          accessUrl:
            `https://gateway.example/api/v1/access/subscription?token=${token}`,
        },
        requestId: 'request-id',
      });
      expect(text).not.toContain('v2board-hidden.example');
      expect(text).not.toContain('/raw/subscribe');
      expect(text).not.toContain('private-uuid');
      expect(Object.keys(JSON.parse(text).data)).toEqual(['rotated', 'accessUrl']);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(upstreamFetch).toHaveBeenCalledTimes(2);
      expect(upstreamFetch.mock.calls.map(([url]) => url)).toEqual([
        'https://private.example/api/v1/user/order/fetch',
        'https://private.example/api/v1/user/resetSecurity',
      ]);
    }
  );

  it('requires auth and does not accept GET as a mutation method', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const unauthenticated = await app.request(
      'https://gateway.example/api/v1/subscription/rotate-access',
      { method: 'POST' },
      env
    );
    const get = await app.fetch(rotationRequest('GET'), env);

    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(get.status).toBe(404);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['Reset failed', 'SUBSCRIPTION_ROTATION_FAILED'],
    ['重置失败', 'SUBSCRIPTION_ROTATION_FAILED'],
    ['The user does not exist', 'UPSTREAM_ERROR'],
    ['Unknown reset failure', 'UPSTREAM_ERROR'],
  ])('normalizes %s without leaking it', async (message, code) => {
    const token = 'ROTATED_SECRET_TOKEN_ABC123';
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ plan_id: 7, status: 3 }] })
      )
      .mockResolvedValueOnce(
        jsonResponse({ message, token, uuid: 'private-uuid' }, 500)
      );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(rotationRequest(), env);
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).toContain(code);
    expect(text).not.toContain(message);
    expect(text).not.toContain(token);
    expect(text).not.toContain('private-uuid');
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it('normalizes timeout without retry, getSubscribe, or sensitive logs', async () => {
    const secret = 'ROTATED_SECRET_TOKEN_ABC123';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ plan_id: 7, status: 3 }] })
      )
      .mockRejectedValueOnce(
        new DOMException(`timed out ${secret}`, 'TimeoutError')
      );
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(rotationRequest(), env);
    const text = await response.text();

    expect(response.status).toBe(504);
    expect(text).toContain('UPSTREAM_TIMEOUT');
    expect(text).not.toContain(secret);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(upstreamFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://private.example/api/v1/user/order/fetch',
      'https://private.example/api/v1/user/resetSecurity',
    ]);
    const logged = JSON.stringify([...error.mock.calls, ...log.mock.calls]);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('private.example');
    expect(logged).not.toContain('opaque-auth');
  });

  it('validates the public origin before mutating credentials', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.fetch(
      new Request('http://gateway.example/api/v1/subscription/rotate-access', {
        method: 'POST',
        headers: { Authorization: 'Bearer opaque-auth' },
      }),
      env
    );

    expect(response.status).toBe(502);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/access/subscription', () => {
  it.each([
    ['Clash YAML', 'proxies:\n  - name: test\n'],
    ['generic base64', 'dmxlc3M6Ly90ZXN0Cg=='],
    ['Sing-box UTF-8', '{"outbounds":[{"tag":"香港节点"}]}'],
  ])('streams %s unchanged', async (_case, body) => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      'https://gateway.example/api/v1/access/subscription?token=opaque_token-123',
      { headers: { 'User-Agent': 'Clash.Meta/1.0' } },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    'clash.meta/1.19.0',
    'Shadowrocket/2100 CFNetwork/1498',
    'sing-box 1.12.0',
  ])('forwards validated subscription User-Agent %s', async (userAgent) => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('subscription'));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      'https://gateway.example/api/v1/access/subscription?token=opaque_token-123',
      { headers: { 'User-Agent': userAgent } },
      env
    );

    expect(response.status).toBe(200);
    const [url, init] = upstreamFetch.mock.calls[0];
    expect(url).toBe(
      'https://private.example/hidden-subscribe?token=opaque_token-123'
    );
    expect(init?.redirect).toBe('manual');
    const headers = new Headers(init?.headers);
    expect(headers.get('user-agent')).toBe(userAgent);
    expect(headers.get('cf-access-client-id')).toBe('access-client-id');
    expect(headers.get('cf-access-client-secret')).toBe('access-client-secret');
  });

  it('does not add User-Agent when absent', async () => {
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('subscription'));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      'https://gateway.example/api/v1/access/subscription?token=opaque_token-123',
      undefined,
      env
    );

    expect(response.status).toBe(200);
    expect(
      new Headers(upstreamFetch.mock.calls[0][1]?.headers).has('user-agent')
    ).toBe(false);
  });

  it('rejects invalid token and oversized User-Agent before upstream fetch', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    for (const request of [
      new Request('https://gateway.example/api/v1/access/subscription'),
      new Request(
        'https://gateway.example/api/v1/access/subscription?token=bad%2Ftoken'
      ),
      new Request(
        'https://gateway.example/api/v1/access/subscription?token=one&token=two'
      ),
      new Request(
        'https://gateway.example/api/v1/access/subscription?token=one&flag=clash'
      ),
      new Request(
        'https://gateway.example/api/v1/access/subscription?token=opaque_token-123',
        { headers: { 'User-Agent': 'a'.repeat(513) } }
      ),
    ]) {
      const response = await app.fetch(request, env);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('subscription_unavailable');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it.each([
    [302, 502],
    [403, 404],
    [500, 502],
  ])('normalizes upstream HTTP %s to %s', async (upstreamStatus, publicStatus) => {
    const cancel = vi.fn();
    const upstreamFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(responseWithCancellableBody(upstreamStatus, cancel));
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      'https://gateway.example/api/v1/access/subscription?token=opaque_token-123',
      undefined,
      env
    );

    expect(response.status).toBe(publicStatus);
    expect(await response.text()).toBe('subscription_unavailable');
    expect(response.headers.has('location')).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it('normalizes an upstream timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('The operation timed out', 'TimeoutError')
      )
    );

    const response = await app.request(
      'https://gateway.example/api/v1/access/subscription?token=opaque_token-123',
      undefined,
      env
    );

    expect(response.status).toBe(504);
    expect(await response.text()).toBe('subscription_unavailable');
  });

  it('does not log the subscription token or upstream error body', async () => {
    const token = 'sensitive_subscription_token';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('private upstream failure', { status: 500 })
      )
    );

    const response = await app.request(
      `https://gateway.example/api/v1/access/subscription?token=${token}`,
      undefined,
      env
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('subscription_unavailable');
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain('private upstream failure');
  });

  it('rejects unsafe deployment subscription paths', async () => {
    const upstreamFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await app.request(
      'https://gateway.example/api/v1/access/subscription?token=opaque_token-123',
      undefined,
      { ...env, V2BOARD_SUBSCRIBE_PATH: 'https://attacker.example/sub' }
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('subscription_unavailable');
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
