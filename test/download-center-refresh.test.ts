import { describe, expect, it, vi } from 'vitest';
import {
  createRegistryModuleLkg,
  createRegistryOperationalSnapshot,
  persistRegistryOperationalSnapshot,
  REGISTRY_SNAPSHOT_KEY,
} from '../src/registry/operational';
import { RegistryValidationState } from '../src/registry/kernel';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import {
  downloadCenterSnapshotSchema,
  type DownloadCenterItemConfig,
} from '../src/registry/modules/download-center';
import { refreshDownloadCenterResolvedState } from '../src/registry/download-center-refresh';
import {
  DOWNLOAD_CENTER_RESOLVED_KEY,
  loadDownloadCenterResolvedState,
  readAvailableDownloads,
} from '../src/registry/download-center-resolved';
import { FakeKV } from './helpers/fake-kv';

function item(overrides: Record<string, unknown> = {}): DownloadCenterItemConfig {
  return downloadCenterSnapshotSchema.parse({
    items: [
      {
        id: 'desktop-client',
        label: { default: 'Desktop Client' },
        audience: 'public',
        platform: 'macos',
        arch: 'arm64',
        github: {
          repository: 'owner/repo',
          release: 'latest',
          assetMatch: {
            prefix: null,
            suffix: '.dmg',
            contains: [],
            include: ['arm64'],
            exclude: ['sha256'],
          },
        },
        refreshHours: 24,
        maxStaleHours: 168,
        mirrors: [],
        ...overrides,
      },
    ],
  }).items[0];
}

async function kvWithConfig(items: DownloadCenterItemConfig[], now: number): Promise<FakeKV> {
  const kv = new FakeKV();
  const lkg = await createRegistryModuleLkg({
    moduleId: 'download-center',
    validatedAt: now,
    sourceFetchedAt: now,
    exposure: 'public',
    config: { items },
  });
  const snapshot = await createRegistryOperationalSnapshot({
    generatedAt: now,
    modules: [
      {
        moduleId: 'download-center',
        latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true },
        lkg,
      },
    ],
  });
  await persistRegistryOperationalSnapshot(kv.binding(), snapshot, registryOperationalDefinitions);
  return kv;
}

function githubRelease(name = 'client-arm64.dmg', repository = 'owner/repo') {
  return new Response(
    JSON.stringify({
      tag_name: 'v1.2.3',
      published_at: '2026-09-25T00:00:00Z',
      assets: [
        {
          name,
          browser_download_url: `https://github.com/${repository}/releases/download/v1.2.3/${name}`,
          size: 123,
          raw: 'RAW_ASSET_SENTINEL',
        },
      ],
      raw: 'RAW_GITHUB_SENTINEL',
      token: 'SECRET_SENTINEL',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

function env(kv: FakeKV) {
  return { REGISTRY_KV: kv.binding() };
}

describe('Download Center derived LKG refresh', () => {
  it('creates fresh normalized derived state under the fixed key', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig([item()], now);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(githubRelease());

    await expect(
      refreshDownloadCenterResolvedState(env(kv), { fetcher, now: () => now })
    ).resolves.toEqual({ ok: true, resolved: 1, unavailable: 0 });

    expect(kv.values.has(DOWNLOAD_CENTER_RESOLVED_KEY)).toBe(true);
    const loaded = await loadDownloadCenterResolvedState(kv.binding());
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.state.items[0]).toMatchObject({
        id: 'desktop-client',
        lastAttemptAt: now,
        resolvedAt: now,
        expiresAt: now + 168 * 60 * 60 * 1000,
        data: { id: 'desktop-client', version: 'v1.2.3' },
      });
    }
    const persisted = kv.values.get(DOWNLOAD_CENTER_RESOLVED_KEY)!;
    for (const forbidden of [
      'RAW_GITHUB_SENTINEL',
      'RAW_ASSET_SENTINEL',
      'SECRET_SENTINEL',
      'assetMatch',
      'template',
      'repository',
      'aureole.registry',
    ]) {
      expect(persisted).not.toContain(forbidden);
    }
  });

  it('respects refreshHours and does not fetch again before due', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig([item()], now);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(githubRelease());
    await refreshDownloadCenterResolvedState(env(kv), { fetcher, now: () => now });
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher,
      now: () => now + 23 * 60 * 60 * 1000,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('keeps a valid prior LKG after GitHub failure and expires it at maxStaleHours', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig([item({ refreshHours: 1, maxStaleHours: 2 })], now);
    const success = vi.fn<typeof fetch>().mockResolvedValue(githubRelease());
    await refreshDownloadCenterResolvedState(env(kv), { fetcher: success, now: () => now });

    const failure = vi.fn<typeof fetch>().mockResolvedValue(githubRelease('client-x64.dmg'));
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: failure,
      now: () => now + 60 * 60 * 1000,
    });
    expect(await readAvailableDownloads(kv.binding(), now + 2 * 60 * 60 * 1000)).toHaveLength(1);
    expect(await readAvailableDownloads(kv.binding(), now + 2 * 60 * 60 * 1000 + 1)).toEqual([]);
  });

  it('records an unavailable attempt without retrying on every scheduler tick', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig([item()], now);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(githubRelease('client-x64.dmg'));
    await refreshDownloadCenterResolvedState(env(kv), { fetcher, now: () => now });
    await refreshDownloadCenterResolvedState(env(kv), { fetcher, now: () => now + 1_000 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await readAvailableDownloads(kv.binding(), now + 1_000)).toEqual([]);
  });

  it('isolates one item failure from another successful item', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(
      [item(), item({ id: 'linux-client', github: { ...item().github, repository: 'owner/linux' } })],
      now
    );
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input).includes('/owner/repo/')
        ? githubRelease()
        : new Response('upstream', { status: 500 })
    );
    await refreshDownloadCenterResolvedState(env(kv), { fetcher, now: () => now });
    expect((await readAvailableDownloads(kv.binding(), now)).map((entry) => entry.id)).toEqual([
      'desktop-client',
    ]);
  });

  it('removes disabled or removed items from the derived collection', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig([item()], now);
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(githubRelease()),
      now: () => now,
    });

    const emptyKv = await kvWithConfig([], now + 1);
    kv.values.set(REGISTRY_SNAPSHOT_KEY, emptyKv.values.get(REGISTRY_SNAPSHOT_KEY)!);
    await refreshDownloadCenterResolvedState(env(kv), { now: () => now + 1 });
    expect(await readAvailableDownloads(kv.binding(), now + 1)).toEqual([]);

    const disabledSnapshot = await createRegistryOperationalSnapshot({
      generatedAt: now + 2,
      modules: [
        {
          moduleId: 'download-center',
          latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false },
        },
      ],
    });
    await persistRegistryOperationalSnapshot(kv.binding(), disabledSnapshot, registryOperationalDefinitions);
    await refreshDownloadCenterResolvedState(env(kv), { now: () => now + 2 });
    expect(await readAvailableDownloads(kv.binding(), now + 2)).toEqual([]);
  });

  it('fails safely for missing/corrupt derived state and rebuilds from Registry config', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig([item()], now);
    expect(await readAvailableDownloads(kv.binding(), now)).toEqual([]);
    kv.values.set(DOWNLOAD_CENTER_RESOLVED_KEY, '{bad-json');
    expect(await readAvailableDownloads(kv.binding(), now)).toEqual([]);
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(githubRelease()),
      now: () => now,
    });
    expect(await readAvailableDownloads(kv.binding(), now)).toHaveLength(1);
  });

  it('clears public derived output when the Registry snapshot is unavailable', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig([item()], now);
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(githubRelease()),
      now: () => now,
    });
    kv.values.delete(REGISTRY_SNAPSHOT_KEY);
    await refreshDownloadCenterResolvedState(env(kv), { now: () => now + 1 });
    expect(await readAvailableDownloads(kv.binding(), now + 1)).toEqual([]);
  });

  it('does not require or persist a GitHub token binding', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig([item()], now);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(githubRelease());
    await refreshDownloadCenterResolvedState(env(kv), { fetcher, now: () => now });
    const headers = new Headers((fetcher.mock.calls[0][1] as RequestInit).headers);
    expect(headers.has('authorization')).toBe(false);
    expect(kv.values.get(DOWNLOAD_CENTER_RESOLVED_KEY)).not.toContain('token');
  });
});
