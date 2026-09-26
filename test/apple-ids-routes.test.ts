import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

const auth = { Authorization: 'Bearer opaque-token', 'cf-ray': 'm14-request' };
const env = { V2BOARD_BASE_URL: 'https://private.example/api/v1/' };
const user = { data: { email: 'user@example.test', expired_at: null, banned: false } };
const account = (username: string, password: string, overrides: Record<string, unknown> = {}) => ({
  username,
  password,
  status: true,
  last_check: '2026-09-26 12:00:00',
  frontend_remark: 'Available',
  ...overrides,
});
const provider = (accounts: unknown[], status = true) => ({
  status,
  msg: 'ok',
  accounts,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});
const request = (path: string, body?: unknown) => app.request(
  `/api/v1/apple-ids${path}`,
  { method: body === undefined ? 'GET' : 'POST', headers: auth, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
  env
);

function withAuthenticatedUser(responses: Response[]) {
  const fetcher = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetcher.mockResolvedValueOnce(json(user)).mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AppleAuto Shared Page API', () => {
  it('normalizes list, boolean statuses and optional remarks without returning passwords', async () => {
    const fetcher = withAuthenticatedUser([json(provider([
      account('first@example.test', 'secret-one'),
      account('second@example.test', 'secret-two', { status: false, frontend_remark: '' }),
      account('third@example.test', 'secret-three', { frontend_remark: undefined }),
    ]))]);
    const res = await request('');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: true,
      data: { items: [
        { username: 'first@example.test', status: true, lastCheck: '2026-09-26 12:00:00', remark: 'Available' },
        { username: 'second@example.test', status: false, lastCheck: '2026-09-26 12:00:00', remark: null },
        { username: 'third@example.test', status: true, lastCheck: '2026-09-26 12:00:00', remark: null },
      ] },
      requestId: 'm14-request',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toBe('https://id.8babao.com/shareapi/id');
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'GET', redirect: 'manual' });
  });

  it('accepts an empty array', async () => {
    withAuthenticatedUser([json(provider([]))]);
    expect(await (await request('')).json()).toMatchObject({ data: { items: [] } });
  });

  it('requires Bearer authorization before upstream access for both routes', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    for (const [path, init] of [
      ['/api/v1/apple-ids', undefined],
      ['/api/v1/apple-ids/reveal', { method: 'POST', body: JSON.stringify({ username: 'a' }) }],
    ] as const) {
      const res = await app.request(path, init, env);
      expect(res.status).toBe(401);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/v1/apple-ids', undefined],
    ['/api/v1/apple-ids/reveal', { username: 'a' }],
  ] as const)('rejects an invalid Bearer token before AppleAuto for %s', async (path, body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ message: 'invalid token' }, 403));
    vi.stubGlobal('fetch', fetcher);
    const res = await app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: auth,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'AUTH_FAILED' } });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe('https://private.example/api/v1/user/info');
  });

  it('fetches again on reveal, choosing username after reorder and returning only fresh password', async () => {
    const fetcher = withAuthenticatedUser([
      json(provider([account('a', 'old-a'), account('b', 'old-b')])),
      json(provider([account('b', 'fresh-b'), account('a', 'fresh-a')])),
    ]);
    const list = await request('');
    expect(JSON.stringify(await list.json())).not.toContain('old-');
    const res = await request('/reveal', { username: 'a' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      ok: true,
      data: { username: 'a', password: 'fresh-a', status: true, lastCheck: '2026-09-26 12:00:00', remark: 'Available' },
      requestId: 'm14-request',
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([
    [provider([account('b', 'other-secret')]), 'disappeared'],
    [provider([account('a', 'secret-one'), account('a', 'secret-two')]), 'duplicate'],
  ])('fails deterministically when target is %s (%s)', async (payload) => {
    withAuthenticatedUser([json(payload)]);
    const res = await request('/reveal', { username: 'a' });
    expect(res.status).toBe(409);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: 'APPLE_ID_ACCOUNT_UNAVAILABLE' } });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it.each([{}, { username: '' }, { username: 'a', other: 1 }, { username: 123 }])(
    'rejects invalid reveal request before fetching', async (body) => {
      const fetcher = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetcher.mockResolvedValue(json(user)));
      const res = await request('/reveal', body);
      expect(res.status).toBe(400);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  );

  it.each([
    ['non-200', json({ status: true }, 503), 'APPLE_ID_UPSTREAM_UNREACHABLE', 502],
    ['redirect', new Response(null, { status: 302, headers: { Location: 'https://elsewhere.test' } }), 'APPLE_ID_UPSTREAM_UNREACHABLE', 502],
    ['invalid JSON', new Response('{broken'), 'APPLE_ID_UPSTREAM_INVALID', 502],
    ['malformed', json({ status: true, msg: 'ok', accounts: [{ username: 'a', password: 'secret' }] }), 'APPLE_ID_UPSTREAM_INVALID', 502],
    ['business failure', json({ status: false, msg: 'sensitive provider detail' }), 'APPLE_ID_PROVIDER_FAILURE', 502],
  ] as const)('maps %s to typed failure without provider details', async (_label, upstream, code, status) => {
    withAuthenticatedUser([upstream]);
    const res = await request('');
    expect(res.status).toBe(status);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ error: { code } });
    expect(JSON.stringify(body)).not.toContain('sensitive provider detail');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('maps network rejection and timeout separately', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(user))
      .mockRejectedValueOnce(new Error('sensitive network error')));
    const network = await request('');
    expect(network.status).toBe(502);
    expect(await network.json()).toMatchObject({ error: { code: 'APPLE_ID_UPSTREAM_UNREACHABLE' } });

    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(user))
      .mockImplementationOnce(() => new Promise(() => {})));
    const pending = request('');
    await vi.advanceTimersByTimeAsync(10_000);
    const timeout = await pending;
    expect(timeout.status).toBe(504);
    expect(timeout.headers.get('Cache-Control')).toBe('no-store');
    expect(await timeout.json()).toMatchObject({ error: { code: 'UPSTREAM_TIMEOUT' } });
  });

  it('times out when response headers arrive but its body stalls', async () => {
    vi.useFakeTimers();
    withAuthenticatedUser([new Response(
      new ReadableStream({ start() {} }),
      { headers: { 'Content-Type': 'application/json' } }
    )]);
    const pending = request('');
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await pending;
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ error: { code: 'UPSTREAM_TIMEOUT' } });
  });
});
