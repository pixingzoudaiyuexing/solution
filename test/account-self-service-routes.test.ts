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

async function request(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: unknown,
  authenticated = true
): Promise<Response> {
  return app.request(
    path,
    {
      method,
      headers: {
        ...(authenticated ? { Authorization: 'Bearer opaque-token' } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'cf-ray': 'request-id',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/v1/me/password', () => {
  it('returns changed=true and never issues a replacement token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true, auth_data: 'must-ignore' }));
    vi.stubGlobal('fetch', fetcher);
    const response = await request('/api/v1/me/password', 'POST', {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { changed: true },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing current', { newPassword: 'new-password' }],
    ['missing new', { currentPassword: 'old-password' }],
    ['empty current', { currentPassword: '', newPassword: 'new-password' }],
    ['short new', { currentPassword: 'old-password', newPassword: '1234567' }],
    ['long current', { currentPassword: 'x'.repeat(1025), newPassword: 'new-password' }],
    ['long new', { currentPassword: 'old-password', newPassword: 'x'.repeat(1025) }],
    ['extra field', { currentPassword: 'old-password', newPassword: 'new-password', token: 'x' }],
  ])('rejects %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await request('/api/v1/me/password', 'POST', body);
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires auth before parsing the body', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await request('/api/v1/me/password', 'POST', {}, false);
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['The old password is wrong', 422, 'PASSWORD_CHANGE_FAILED'],
    ['Save failed', 422, 'PASSWORD_CHANGE_FAILED'],
    ['Unexpected password error', 502, 'UPSTREAM_ERROR'],
  ] as const)('normalizes %s', async (message, status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    const response = await request('/api/v1/me/password', 'POST', {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).toContain(code);
    expect(text).not.toContain(message);
  });

  it('normalizes timeout without retrying', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', fetcher);
    const response = await request('/api/v1/me/password', 'POST', {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });
    expect(response.status).toBe(504);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('PATCH /api/v1/me/preferences', () => {
  it('updates all preferences through the public boolean contract', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true }));
    vi.stubGlobal('fetch', fetcher);
    const response = await request('/api/v1/me/preferences', 'PATCH', {
      autoRenewal: true,
      remindExpire: true,
      remindTraffic: false,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { updated: true },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('updates one preference without sending missing fields', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true }));
    vi.stubGlobal('fetch', fetcher);
    const response = await request('/api/v1/me/preferences', 'PATCH', {
      remindTraffic: false,
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      remind_traffic: 0,
    });
  });

  it.each([
    ['empty', {}],
    ['numeric boolean', { autoRenewal: 1 }],
    ['string boolean', { remindExpire: 'true' }],
    ['extra field', { remindTraffic: false, balance: 0 }],
  ])('rejects %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await request('/api/v1/me/preferences', 'PATCH', body);
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes save failure, malformed success, and timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'Save failed' }, 500))
    );
    const failed = await request('/api/v1/me/preferences', 'PATCH', {
      remindTraffic: false,
    });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({
      error: { code: 'PREFERENCES_UPDATE_FAILED' },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: false }))
    );
    const malformed = await request('/api/v1/me/preferences', 'PATCH', {
      remindTraffic: false,
    });
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const timeout = await request('/api/v1/me/preferences', 'PATCH', {
      remindTraffic: false,
    });
    expect(timeout.status).toBe(504);
  });
});

describe('GET /api/v1/me/stats', () => {
  it.each([
    [[0, 0, 0], { pendingOrders: 0, openTickets: 0, invitedUsers: 0 }],
    [[2, 3, 4], { pendingOrders: 2, openTickets: 3, invitedUsers: 4 }],
  ] as const)('maps positional stats %#', async (data, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data }))
    );
    const response = await request('/api/v1/me/stats', 'GET');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: expected,
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    { data: [0, 0] },
    { data: [-1, 0, 0] },
    { data: [1.5, 0, 0] },
    { data: ['1', 0, 0] },
    { data: [2_147_483_648, 0, 0] },
    { stats: [0, 0, 0] },
  ])('fails closed on malformed stats %#', async (payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );
    const response = await request('/api/v1/me/stats', 'GET');
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'UPSTREAM_ERROR' } });
  });

  it('normalizes timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const response = await request('/api/v1/me/stats', 'GET');
    expect(response.status).toBe(504);
  });
});

describe('account self-service security', () => {
  it('does not log passwords, token, or upstream details', async () => {
    const currentPassword = 'sensitive-current-password';
    const newPassword = 'sensitive-new-password';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>sensitive upstream failure</h1>', { status: 500 })
      )
    );
    await request('/api/v1/me/password', 'POST', {
      currentPassword,
      newPassword,
    });
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(currentPassword);
    expect(logged).not.toContain(newPassword);
    expect(logged).not.toContain('opaque-token');
    expect(logged).not.toContain('sensitive upstream failure');
    expect(logged).not.toContain('backend.example');
  });
});
