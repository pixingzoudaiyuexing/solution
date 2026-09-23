import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { app, scheduled } from '../src/index';
import { v1Router } from '../src/routes/v1';
import { REGISTRY_SNAPSHOT_KEY } from '../src/registry/operational';
import { FakeKV } from './helpers/fake-kv';

function executionContext(): {
  context: ExecutionContext;
  promises: Promise<unknown>[];
} {
  const promises: Promise<unknown>[] = [];
  return {
    context: {
      waitUntil(promise) {
        promises.push(promise);
      },
      passThroughOnException() {},
      props: {},
    } as ExecutionContext,
    promises,
  };
}

function controller(): ScheduledController {
  return {
    scheduledTime: 0,
    cron: 'test-only',
    noRetry() {},
  } as ScheduledController;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Worker fetch and scheduled boundaries', () => {
  it('preserves default Worker fetch delegation and the 52-route contract', async () => {
    expect(
      new Set(v1Router.routes.map((route) => `${route.method} ${route.path}`))
        .size
    ).toBe(52);
    const response = await worker.fetch!(
      new Request('https://gateway.example/api/v1/not-found'),
      {},
      executionContext().context
    );
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('404 Not Found');
  });

  it('invokes one internal refresh through waitUntil per scheduled event', async () => {
    const kv = new FakeKV();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetcher);
    const env = {
      REGISTRY_KV: kv.binding(),
      V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
      V2BOARD_CONTROL_AUTH_DATA: 'test-auth-data',
      V2BOARD_CONTROL_ADMIN_PREFIX: 'secure-admin',
    };
    const ctx = executionContext();

    scheduled(controller(), env, ctx.context);

    expect(ctx.promises).toHaveLength(1);
    await Promise.all(ctx.promises);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'https://backend.example/api/v1/secure-admin/knowledge/fetch'
    );
    expect(kv.values.has(REGISTRY_SNAPSHOT_KEY)).toBe(true);
  });

  it('fails safely without REGISTRY_KV and does not call the Admin source', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const ctx = executionContext();

    scheduled(
      controller(),
      {
        V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
        V2BOARD_CONTROL_AUTH_DATA: 'test-auth-data',
        V2BOARD_CONTROL_ADMIN_PREFIX: 'secure-admin',
      },
      ctx.context
    );

    expect(ctx.promises).toHaveLength(1);
    await expect(Promise.all(ctx.promises)).resolves.toEqual([undefined]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not expose Registry refresh, health, or Control Plane HTTP routes', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    for (const path of [
      '/api/v1/registry',
      '/api/v1/registry/refresh',
      '/api/v1/health',
      '/api/v1/check',
      '/api/v1/control-plane',
    ]) {
      const response = await app.request(path, undefined, {
        V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
      });
      expect(response.status).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps default D-005 subscription behavior independent from Registry KV', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { banned: 0, transfer_enable: 0, expired_at: null },
          }),
          {
          headers: { 'Content-Type': 'application/json' },
          }
        )
      );
    vi.stubGlobal('fetch', fetcher);
    const response = await worker.fetch!(
      new Request('https://gateway.example/api/v1/subscription', {
        headers: {
          Authorization: 'Bearer opaque-user-auth',
          'cf-ray': 'request-id',
        },
      }),
      {
        V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
        V2BOARD_SUBSCRIBE_PATH: '/client/subscribe',
      },
      executionContext().context
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { eligible: false, accessUrl: null },
      requestId: 'request-id',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'https://backend.example/api/v1/user/info'
    );
  });
});
