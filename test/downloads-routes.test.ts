import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DownloadItem,
  DownloadsSuccessResponse,
} from '../src/contract/v1/downloads';
import { app } from '../src/index';
import { DOWNLOAD_CENTER_DIAGNOSTIC_KEY } from '../src/registry/download-center-diagnostic';
import {
  DOWNLOAD_CENTER_RESOLVED_KEY,
  persistDownloadCenterResolvedState,
} from '../src/registry/download-center-resolved';
import { FakeKV } from './helpers/fake-kv';

const now = Date.parse('2026-09-25T00:00:00.000Z');

function data(id: string): DownloadItem {
  const source = `https://github.com/owner/repo/releases/download/v1.2.3/${id}.dmg`;
  return {
    id,
    label: id === 'windows' ? 'Windows' : 'Debian / Ubuntu',
    platform: id === 'windows' ? 'windows' : 'linux',
    arch: id === 'windows' ? 'x64' : 'arm64',
    version: 'v1.2.3',
    publishedAt: '2026-09-25T00:00:00.000Z',
    filename: `${id}.dmg`,
    sizeBytes: 123,
    downloads: [
      {
        id: 'hubproxy-self',
        label: '高速下载',
        url: `https://git.hubproxy.top/${source}`,
      },
      {
        id: 'gh-proxy-public',
        label: '备用下载',
        url: `https://gh-proxy.com/${source}`,
      },
    ],
  };
}

async function kvWith(
  entries: Array<{ id: string; available?: boolean }>
): Promise<FakeKV> {
  const kv = new FakeKV();
  await persistDownloadCenterResolvedState(kv.binding(), {
    schemaVersion: 2,
    generatedAt: now,
    items: entries.map((entry) => ({
      id: entry.id,
      configFingerprint: 'a'.repeat(64),
      lastAttemptAt: now,
      ...(entry.available === false
        ? {}
        : {
            resolvedAt: now,
            expiresAt: now + 1_000,
            data: data(entry.id),
          }),
    })),
  });
  return kv;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('GET /api/v1/downloads', () => {
  it('returns the exact anonymous downloads DTO without external requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const kv = await kvWith([{ id: 'windows' }]);
    kv.values.set(
      DOWNLOAD_CENTER_DIAGNOSTIC_KEY,
      JSON.stringify({
        schemaVersion: 1,
        checkedAt: now,
        repositories: [
          {
            repository: 'owner/repo',
            attemptedAt: now,
            elapsedMs: 10_000,
            status: 'error',
            errorCode: 'TIMEOUT',
          },
        ],
      })
    );
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/downloads',
      { headers: { 'cf-ray': 'request-id' } },
      { REGISTRY_KV: kv.binding() }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as DownloadsSuccessResponse;
    expect(body).toEqual({
      ok: true,
      data: { items: [data('windows')] },
      requestId: 'request-id',
    });
    expect(body.data.items[0].downloads).toHaveLength(2);
    expect(body.data.items[0].downloads.every((entry: { url: string }) =>
      entry.url !== 'https://github.com/owner/repo/releases/download/v1.2.3/windows.dmg'
    )).toBe(true);
    expect('downloadUrl' in body.data.items[0]).toBe(false);
    expect('mirrors' in body.data.items[0]).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(kv.reads).toEqual([DOWNLOAD_CENTER_RESOLVED_KEY]);
  });

  it('returns only currently available items for a partial collection', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const kv = await kvWith([
      { id: 'windows' },
      { id: 'linux-deb-arm64', available: false },
    ]);
    const response = await app.request('/api/v1/downloads', undefined, {
      REGISTRY_KV: kv.binding(),
    });
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { items: [{ id: 'windows' }] },
    });
  });

  it('ignores corrupt internal diagnostics without outbound requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const kv = await kvWith([{ id: 'windows' }]);
    kv.values.set(DOWNLOAD_CENTER_DIAGNOSTIC_KEY, '{bad-json');
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request('/api/v1/downloads', undefined, {
      REGISTRY_KV: kv.binding(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { items: [{ id: 'windows' }] },
    });
    expect(kv.reads).toEqual([DOWNLOAD_CENTER_RESOLVED_KEY]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['missing binding', 'missing state', 'corrupt state', 'old v1 state', 'expired state'])(
    'returns a non-cacheable empty collection for %s',
    async (state) => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const kv = new FakeKV();
      if (state === 'corrupt state') {
        kv.values.set(DOWNLOAD_CENTER_RESOLVED_KEY, '{bad-json');
      }
      if (state === 'old v1 state') {
        kv.values.set(
          DOWNLOAD_CENTER_RESOLVED_KEY,
          JSON.stringify({ schemaVersion: 1, generatedAt: now, items: [] })
        );
      }
      if (state === 'expired state') {
        const seeded = await kvWith([{ id: 'windows' }]);
        kv.values.set(
          DOWNLOAD_CENTER_RESOLVED_KEY,
          seeded.values.get(DOWNLOAD_CENTER_RESOLVED_KEY)!
        );
        vi.setSystemTime(now + 1_001);
      }
      const response = await app.request(
        '/api/v1/downloads',
        undefined,
        state === 'missing binding' ? {} : { REGISTRY_KV: kv.binding() }
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ ok: true, data: { items: [] } });
    }
  );

  it('does not expose derived metadata, provider internals, or obsolete fields', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const kv = await kvWith([{ id: 'windows' }]);
    const response = await app.request('/api/v1/downloads', undefined, {
      REGISTRY_KV: kv.binding(),
    });
    const text = await response.text();
    for (const forbidden of [
      'configFingerprint',
      'lastAttemptAt',
      'expiresAt',
      'REGISTRY_KV',
      'registry:download-center',
      'assetMatch',
      'baseUrl',
      'repository',
      'downloadUrl',
      'mirrors',
      'health',
      'diagnostic',
      'errorCode',
      'elapsedMs',
      'attemptedAt',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
