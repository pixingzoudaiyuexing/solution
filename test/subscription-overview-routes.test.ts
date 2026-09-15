import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
  V2BOARD_SUBSCRIBE_PATH: '/hidden-subscribe',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function upstream(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    plan_id: 7,
    expired_at: 1893456000,
    u: 123,
    d: 456,
    transfer_enable: 107374182400,
    device_limit: null,
    alive_ip: 1,
    reset_day: null,
    allow_new_period: '0',
    plan: {
      id: 7,
      name: 'Pro Plan',
      group_id: 2,
      content: 'private plan',
    },
    token: 'private-token',
    subscribe_url: 'https://backend.example/sub?token=private',
    uuid: 'private-uuid',
    email: 'private@example.com',
    ...overrides,
  };
  return {
    data,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/v1/subscription/overview', () => {
  it('returns only the public overview DTO', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(upstream()));
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/subscription/overview',
      {
        headers: { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' },
      },
      env
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      data: {
        product: { id: '7', name: 'Pro Plan' },
        expiresAt: '2030-01-01T00:00:00.000Z',
        traffic: {
          uploadedBytes: 123,
          downloadedBytes: 456,
          allowanceBytes: 107374182400,
        },
        deviceLimit: null,
        activeDevices: 1,
        resetDay: null,
        renewalAllowed: false,
      },
      requestId: 'request-id',
    });
    const serialized = JSON.stringify(body);
    for (const value of [
      'private-token',
      'backend.example',
      'private-uuid',
      'private@example.com',
      'private plan',
      'group_id',
    ]) {
      expect(serialized).not.toContain(value);
    }
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toContain('/user/getSubscribe');
  });

  it('returns product=null without treating no plan as eligibility', async () => {
    const payload = upstream({ plan_id: null });
    delete payload.data.plan;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/subscription/overview',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { product: null } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('requires authorization without calling upstream', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/subscription/overview', undefined, env);
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps invalid auth, malformed data, and timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Session expired' }, 403)
      )
    );
    let response = await app.request(
      '/api/v1/subscription/overview',
      { headers: { Authorization: 'Bearer invalid' } },
      env
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_FAILED' } });

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(upstream({ u: -1 })))
    );
    response = await app.request(
      '/api/v1/subscription/overview',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });

    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    response = await app.request(
      '/api/v1/subscription/overview',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(response.status).toBe(504);
  });

  it('does not log upstream secrets or the Bearer token', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>private subscription failure</h1>', { status: 500 })
      )
    );
    await app.request(
      '/api/v1/subscription/overview',
      { headers: { Authorization: 'Bearer sensitive-token' } },
      env
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('sensitive-token');
    expect(logged).not.toContain('private subscription failure');
    expect(logged).not.toContain('backend.example');
  });
});
