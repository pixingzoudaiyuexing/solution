import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  FRONTEND_ORIGINS: 'https://client.example',
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
  V2BOARD_SUBSCRIBE_PATH: '/hidden-subscribe',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function request(method = 'POST'): Request {
  return new Request(
    'https://gateway.example/api/v1/subscription/advance-period',
    {
      method,
      headers: {
        Authorization: 'Bearer opaque-token',
        'cf-ray': 'request-id',
      },
    }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/v1/subscription/advance-period', () => {
  it('calls only newPeriod once and returns the minimal response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: true, u: 0, d: 0, expired_at: 1893456000 })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await app.fetch(request(), env);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { advanced: true },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/newPeriod');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe('manual');
  });

  it('requires auth and GET never triggers mutation', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const unauthenticated = await app.request(
      '/api/v1/subscription/advance-period',
      { method: 'POST' },
      env
    );
    const get = await app.fetch(request('GET'), env);

    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      error: { code: 'AUTH_REQUIRED' },
    });
    expect(get.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [
      'Renewal is not allowed',
      409,
      'SUBSCRIPTION_PERIOD_ADVANCE_DISABLED',
    ],
    [
      'You have not used up your traffic, you cannot renew your subscription',
      409,
      'SUBSCRIPTION_TRAFFIC_NOT_EXHAUSTED',
    ],
    [
      'You do not allow to renew the subscription',
      409,
      'SUBSCRIPTION_PERIOD_ADVANCE_UNAVAILABLE',
    ],
    [
      'You do not have enough time to renew your subscription',
      409,
      'SUBSCRIPTION_PERIOD_ADVANCE_UNAVAILABLE',
    ],
    ['Save failed', 502, 'SUBSCRIPTION_PERIOD_ADVANCE_FAILED'],
    ['保存失败', 502, 'SUBSCRIPTION_PERIOD_ADVANCE_FAILED'],
    ['Invalid reset period', 502, 'UPSTREAM_ERROR'],
    ['The user does not exist', 502, 'UPSTREAM_ERROR'],
    ['Unknown period failure', 502, 'UPSTREAM_ERROR'],
  ] as const)('normalizes %s without exposing it', async (message, status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message, internal: 'private-state' }, 500)
      )
    );

    const response = await app.fetch(request(), env);
    const text = await response.text();

    expect(response.status).toBe(status);
    expect(text).toContain(code);
    expect(text).not.toContain(message);
    expect(text).not.toContain('private-state');
  });

  it.each([
    { data: false },
    { data: null },
    {},
    { data: 'true' },
    { data: {} },
    [],
  ])('fails closed on malformed success %#', async (payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );

    const response = await app.fetch(request(), env);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_ERROR' },
    });
  });

  it('maps auth rejection before mutation semantics', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ message: 'Session expired' }, 403)
    );
    vi.stubGlobal('fetch', fetcher);
    const response = await app.fetch(request(), env);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_FAILED' } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('normalizes timeout and unknown failure without retry, reads, or sensitive logs', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unknown = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<h1>private new period failure</h1>', { status: 500 })
    );
    vi.stubGlobal('fetch', unknown);
    let response = await app.fetch(request(), env);
    expect(response.status).toBe(502);
    expect(unknown).toHaveBeenCalledOnce();

    const timeout = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', timeout);
    response = await app.fetch(request(), env);
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({
      error: { code: 'UPSTREAM_TIMEOUT' },
    });
    expect(timeout).toHaveBeenCalledOnce();

    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('opaque-token');
    expect(logged).not.toContain('private new period failure');
    expect(logged).not.toContain('backend.example');
  });
});
