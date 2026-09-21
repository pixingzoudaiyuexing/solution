import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const TOKEN = 'SYNTHETIC_TOKEN_DO_NOT_LOG_123';
const env = { V2BOARD_BASE_URL: 'https://hidden.example/api/v1/', V2BOARD_SUBSCRIBE_PATH: '/client/subscribe' };
const ctx = {} as ExecutionContext;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('public root subscription access', () => {
  it.each([
    ['/app/update', '/app/update'],
    ['/legacy/client/subscribe', '/legacy/client/subscribe'],
  ])('streams the configured legacy path %s using its token query', async (path, configuredPath) => {
    const bytes = new Uint8Array([4, 3, 2, 1]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'subscription-userinfo': 'upload=1',
        },
      })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await worker.fetch!(
      new Request(`https://gateway.example${path}?token=${TOKEN}`),
      { ...env, V2BOARD_SUBSCRIBE_PATH: configuredPath },
      ctx
    );

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      `https://hidden.example${configuredPath}?token=${TOKEN}`
    );
    expect(response.headers.get('subscription-userinfo')).toBe('upload=1');
  });

  it.each([
    ['/app/update', '/app/update', 'update'],
    ['/subscribe', '/subscribe', 'subscribe'],
  ])('falls through a configured legacy path without a token query to the modern route', async (path, configuredPath, modernToken) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('modern', { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await worker.fetch!(
      new Request(`https://gateway.example${path}`),
      { ...env, V2BOARD_SUBSCRIBE_PATH: configuredPath },
      ctx
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('modern');
    expect(String(fetcher.mock.calls[0][0])).toBe(
      `https://hidden.example${configuredPath}?token=${modernToken}`
    );
  });

  it.each([
    [`/app/update?info=hide`, '/app/update', 'update'],
    [`/subscribe?profile=default`, '/subscribe', 'subscribe'],
  ])('keeps modern query semantics when a configured legacy path has no token query', async (path, configuredPath, modernToken) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('modern', { status: 200, headers: { 'subscription-userinfo': 'upload=1' } })
    );
    vi.stubGlobal('fetch', fetcher);

    const response = await worker.fetch!(
      new Request(`https://gateway.example${path}`),
      { ...env, V2BOARD_SUBSCRIBE_PATH: configuredPath },
      ctx
    );

    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toBe(
      `https://hidden.example${configuredPath}?token=${modernToken}`
    );
    if (path.includes('info=hide')) expect(response.headers.get('subscription-userinfo')).toBeNull();
    else expect(response.headers.get('subscription-userinfo')).toBe('upload=1');
  });

  it.each([
    '/app/update?token=',
    `/app/update?token=${TOKEN}&token=${TOKEN}`,
    '/app/update?token=bad.token',
    `/app/update?token=${TOKEN}&info=hide`,
  ])('rejects an invalid legacy query on %s without upstream access', async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await worker.fetch!(
      new Request(`https://gateway.example${path}`),
      { ...env, V2BOARD_SUBSCRIBE_PATH: '/app/update' },
      ctx
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('subscription_unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    `/other/update?token=${TOKEN}`,
    `/app/Update?token=${TOKEN}`,
    `/app/%75pdate?token=${TOKEN}`,
    `/app/%2Fupdate?token=${TOKEN}`,
  ])('does not proxy a non-exact legacy path %s', async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await worker.fetch!(
      new Request(`https://gateway.example${path}`),
      { ...env, V2BOARD_SUBSCRIBE_PATH: '/app/update' },
      ctx
    );

    expect([400, 404]).toContain(response.status);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not let a conflicting configured path shadow the api namespace', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await worker.fetch!(
      new Request(`https://gateway.example/api/v1/subscription?token=${TOKEN}`),
      { ...env, V2BOARD_SUBSCRIBE_PATH: '/api/v1/subscription' },
      ctx
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toContain('AUTH_REQUIRED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([`/${TOKEN}`, `/zzz/${TOKEN}`, `/${TOKEN}?profile=default`, `/${TOKEN}?info=show`, `/${TOKEN}?info=hide`, `/zzz/${TOKEN}?profile=default&info=hide`])('streams %s from fixed hidden origin only', async (path) => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'subscription-userinfo': 'upload=1', 'profile-title': 'Test' } })); vi.stubGlobal('fetch', fetcher);
    const response = await worker.fetch!(new Request(`https://attacker.example${path}`), env, ctx);
    expect(response.status).toBe(200); expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(String(fetcher.mock.calls[0][0])).toBe(`https://hidden.example/client/subscribe?token=${TOKEN}`);
    if (path.includes('info=hide')) expect(response.headers.get('subscription-userinfo')).toBeNull(); else expect(response.headers.get('subscription-userinfo')).toBe('upload=1');
    expect(response.headers.get('profile-title')).toBe('Test');
  });

  it.each([`/${TOKEN}?info=hide&info=show`, `/${TOKEN}?profile=default&profile=default`, `/${TOKEN}?x=1`, `/${TOKEN}?profile=meta`, '/bad.token'])('rejects ambiguous/unsupported %s generically', async (path) => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    const response = await worker.fetch!(new Request(`https://gateway.example${path}`), env, ctx);
    expect(response.status).toBe(400); expect(await response.text()).toBe('subscription_unavailable'); expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not shadow api namespace', async () => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    const response = await worker.fetch!(new Request('https://gateway.example/api/v1'), env, ctx);
    expect(response.status).toBe(404); expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps show/hide body byte-identical and logs no token', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bytes = new Uint8Array([9, 8, 7, 0, 255]);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(bytes, { headers: { 'subscription-userinfo': 'x' } })); vi.stubGlobal('fetch', fetcher);
    const show = await worker.fetch!(new Request(`https://gateway.example/${TOKEN}`), env, ctx);
    const hide = await worker.fetch!(new Request(`https://gateway.example/${TOKEN}?info=hide`), env, ctx);
    expect(new Uint8Array(await show.arrayBuffer())).toEqual(new Uint8Array(await hide.arrayBuffer()));
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
  });

  it.each([
    ['rejected', async () => new Response('private', { status: 403 })],
    ['server error', async () => new Response('private', { status: 500 })],
    ['timeout', async () => { throw new DOMException('private timeout', 'TimeoutError'); }],
  ])('keeps token paths and credentials out of logs on %s', async (_case, behavior) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(behavior));
    const rawUrl = `https://gateway.example/${TOKEN}?info=hide`;
    const response = await worker.fetch!(new Request(rawUrl, { headers: { Referer: `https://ref.example/${TOKEN}` } }), env, ctx);
    expect([404, 502, 504]).toContain(response.status);
    const publicBody = await response.text();
    expect(publicBody).toBe('subscription_unavailable');
    const output = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
    for (const forbidden of [TOKEN, rawUrl, `/${TOKEN}`, `https://ref.example/${TOKEN}`]) {
      expect(output).not.toContain(forbidden);
      expect(publicBody).not.toContain(forbidden);
    }
  });

  it('does not log malformed token-bearing request paths', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    const path = '/MALFORMED.TOKEN';
    const response = await worker.fetch!(new Request(`https://gateway.example${path}`), env, ctx);
    expect(response.status).toBe(400);
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain(path);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not log legacy bearer query credentials', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('private', { status: 500 }))
    );
    const rawUrl = `https://gateway.example/app/update?token=${TOKEN}`;

    const response = await worker.fetch!(
      new Request(rawUrl),
      { ...env, V2BOARD_SUBSCRIBE_PATH: '/app/update' },
      ctx
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('subscription_unavailable');
    const output = JSON.stringify([...log.mock.calls, ...error.mock.calls]);
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain(rawUrl);
  });
});
