import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import {
  DOWNLOAD_CENTER_RESOLVED_KEY,
  persistDownloadCenterResolvedState,
} from '../src/registry/download-center-resolved';
import { FakeKV } from './helpers/fake-kv';

const now = Date.parse('2026-09-25T00:00:00.000Z');
const data = (id: string) => ({
  id,
  label: id === 'desktop-client' ? 'Desktop Client' : 'Linux Client',
  platform: id === 'desktop-client' ? 'macos' : 'linux',
  arch: 'arm64',
  version: 'v1.2.3',
  publishedAt: '2026-09-25T00:00:00.000Z',
  downloadUrl: `https://github.com/owner/repo/releases/download/v1.2.3/${id}.dmg`,
  filename: `${id}.dmg`,
  sizeBytes: 123,
  mirrors: [],
});

async function kvWith(entries: Array<{ id: string; expired?: boolean; available?: boolean }>) {
  const kv = new FakeKV();
  await persistDownloadCenterResolvedState(kv.binding(), {
    schemaVersion: 1,
    generatedAt: now,
    items: entries.map((entry) => ({
      id: entry.id,
      configFingerprint: 'a'.repeat(64),
      lastAttemptAt: now,
      ...(entry.available === false
        ? {}
        : {
            resolvedAt: now,
            expiresAt: entry.expired ? now - 1 : now + 1_000,
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
  it('returns the exact anonymous neutral DTO without external requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const kv = await kvWith([{ id: 'desktop-client' }]);
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/downloads',
      { headers: { 'cf-ray': 'request-id' } },
      { REGISTRY_KV: kv.binding() }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      ok: true,
      data: { items: [data('desktop-client')] },
      requestId: 'request-id',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(kv.reads).toEqual([DOWNLOAD_CENTER_RESOLVED_KEY]);
  });

  it('returns only currently available items for a partial collection', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const kv = await kvWith([
      { id: 'desktop-client' },
      { id: 'linux-client', available: false },
    ]);
    const response = await app.request('/api/v1/downloads', undefined, {
      REGISTRY_KV: kv.binding(),
    });
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { items: [{ id: 'desktop-client' }] },
    });
  });

  it.each(['missing binding', 'missing state', 'corrupt state', 'expired state'])(
    'returns a non-cacheable empty collection for %s',
    async (state) => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const kv = new FakeKV();
      if (state === 'corrupt state') kv.values.set(DOWNLOAD_CENTER_RESOLVED_KEY, '{bad-json');
      if (state === 'expired state') {
        const seeded = await kvWith([{ id: 'desktop-client' }]);
        kv.values.set(DOWNLOAD_CENTER_RESOLVED_KEY, seeded.values.get(DOWNLOAD_CENTER_RESOLVED_KEY)!);
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

  it('does not expose derived metadata, key names, templates, or health causes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const kv = await kvWith([{ id: 'desktop-client' }]);
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
      'template',
      'health',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
