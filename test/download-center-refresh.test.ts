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
  type DownloadCenterSnapshot,
} from '../src/registry/modules/download-center';
import { refreshDownloadCenterResolvedState } from '../src/registry/download-center-refresh';
import {
  DOWNLOAD_CENTER_RESOLVED_KEY,
  loadDownloadCenterResolvedState,
  readAvailableDownloads,
} from '../src/registry/download-center-resolved';
import { FakeKV } from './helpers/fake-kv';

const providers = [
  {
    id: 'hubproxy-self',
    label: '高速下载',
    type: 'github-url-prefix',
    baseUrl: 'https://git.hubproxy.top/',
  },
  {
    id: 'gh-proxy-public',
    label: '备用下载',
    type: 'github-url-prefix',
    baseUrl: 'https://gh-proxy.com/',
  },
] as const;

function rawItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'windows',
    label: { default: 'Windows' },
    audience: 'public',
    platform: 'windows',
    arch: 'x64',
    github: {
      repository: 'clash-verge-rev/clash-verge-rev',
      release: 'latest',
      assetMatch: {
        prefix: null,
        suffix: '_x64-setup.exe',
        contains: [],
        include: [],
        exclude: [],
      },
    },
    refreshHours: 24,
    maxStaleHours: 168,
    ...overrides,
  };
}

function snapshot(
  items: Array<Record<string, unknown>> = [rawItem()],
  providerConfig: ReadonlyArray<Record<string, unknown>> = providers,
  defaultIds: [string, string] = ['hubproxy-self', 'gh-proxy-public']
): DownloadCenterSnapshot {
  return downloadCenterSnapshotSchema.parse({
    downloadProviders: providerConfig,
    defaultDownloadProviderIds: defaultIds,
    items,
  });
}

function canonicalItems(): Array<Record<string, unknown>> {
  const clash = 'clash-verge-rev/clash-verge-rev';
  const { arch: _macArch, ...macBase } = rawItem();
  return [
    rawItem(),
    {
      ...macBase,
      id: 'macos',
      label: { default: 'Mac' },
      platform: 'macos',
      github: {
        repository: 'MetaCubeX/ClashX.Meta',
        release: 'latest',
        assetMatch: { prefix: null, suffix: 'ClashX.Meta.zip', contains: [], include: [], exclude: [] },
      },
    },
    rawItem({
      id: 'android',
      label: { default: 'Android' },
      platform: 'android',
      arch: 'universal',
      github: {
        repository: 'MetaCubeX/ClashMetaForAndroid',
        release: 'latest',
        assetMatch: { prefix: null, suffix: '-meta-universal-release.apk', contains: [], include: [], exclude: [] },
      },
    }),
    ...[
      ['linux-deb-x64', 'Debian / Ubuntu', 'x64', '_amd64.deb'],
      ['linux-deb-arm64', 'Debian / Ubuntu', 'arm64', '_arm64.deb'],
      ['linux-rpm-x64', 'Fedora / RHEL', 'x64', '.x86_64.rpm'],
      ['linux-rpm-arm64', 'Fedora / RHEL', 'arm64', '.aarch64.rpm'],
    ].map(([id, label, arch, suffix]) =>
      rawItem({
        id,
        label: { default: label },
        platform: 'linux',
        arch,
        github: {
          repository: clash,
          release: 'latest',
          assetMatch: { prefix: null, suffix, contains: [], include: [], exclude: [] },
        },
      })
    ),
  ];
}

async function writeRegistrySnapshot(
  kv: FakeKV,
  config: DownloadCenterSnapshot,
  now: number
): Promise<void> {
  const lkg = await createRegistryModuleLkg({
    moduleId: 'download-center',
    validatedAt: now,
    sourceFetchedAt: now,
    exposure: 'public',
    config,
  });
  const operational = await createRegistryOperationalSnapshot({
    generatedAt: now,
    modules: [
      {
        moduleId: 'download-center',
        latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true },
        lkg,
      },
    ],
  });
  await persistRegistryOperationalSnapshot(
    kv.binding(),
    operational,
    registryOperationalDefinitions
  );
}

async function kvWithConfig(
  config: DownloadCenterSnapshot,
  now: number
): Promise<FakeKV> {
  const kv = new FakeKV();
  await writeRegistrySnapshot(kv, config, now);
  return kv;
}

function githubRelease(
  repository: string,
  assets: string[],
  tag = 'v2.5.5'
): Response {
  return new Response(
    JSON.stringify({
      tag_name: tag,
      published_at: '2026-09-25T00:00:00Z',
      assets: assets.map((name) => ({
        name,
        browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
        size: 123,
        raw: 'RAW_ASSET_SENTINEL',
      })),
      raw: 'RAW_GITHUB_SENTINEL',
      token: 'SECRET_SENTINEL',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

const clashAssets = [
  'Clash.Verge_2.5.5_x64-setup.exe',
  'clash-verge_2.5.5_amd64.deb',
  'clash-verge_2.5.5_arm64.deb',
  'clash-verge-2.5.5.x86_64.rpm',
  'clash-verge-2.5.5.aarch64.rpm',
];

function canonicalFetcher(options: {
  failMac?: boolean;
  clashAssets?: string[];
} = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const value = String(input);
    if (value.includes('/clash-verge-rev/clash-verge-rev/')) {
      return githubRelease(
        'clash-verge-rev/clash-verge-rev',
        options.clashAssets ?? clashAssets
      );
    }
    if (value.includes('/MetaCubeX/ClashX.Meta/')) {
      return options.failMac
        ? new Response('upstream', { status: 500 })
        : githubRelease('MetaCubeX/ClashX.Meta', ['ClashX.Meta.zip'], 'v1.4.2');
    }
    if (value.includes('/MetaCubeX/ClashMetaForAndroid/')) {
      return githubRelease(
        'MetaCubeX/ClashMetaForAndroid',
        ['cmfa-2.11.4-meta-universal-release.apk'],
        'v2.11.4'
      );
    }
    return new Response('unexpected', { status: 500 });
  });
}

function env(kv: FakeKV) {
  return { REGISTRY_KV: kv.binding() };
}

describe('Download Center derived LKG refresh', () => {
  it('creates schema-v2 public-only derived state with exactly two downloads', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(snapshot(), now);
    const fetcher = canonicalFetcher();

    await expect(
      refreshDownloadCenterResolvedState(env(kv), { fetcher, now: () => now })
    ).resolves.toEqual({ ok: true, resolved: 1, unavailable: 0 });

    const loaded = await loadDownloadCenterResolvedState(kv.binding());
    expect(loaded.status).toBe('valid');
    if (loaded.status === 'valid') {
      expect(loaded.state.schemaVersion).toBe(2);
      expect(loaded.state.items[0].data?.downloads).toEqual([
        expect.objectContaining({ id: 'hubproxy-self' }),
        expect.objectContaining({ id: 'gh-proxy-public' }),
      ]);
    }
    const persisted = kv.values.get(DOWNLOAD_CENTER_RESOLVED_KEY)!;
    for (const forbidden of [
      'RAW_GITHUB_SENTINEL',
      'RAW_ASSET_SENTINEL',
      'SECRET_SENTINEL',
      'assetMatch',
      'baseUrl',
      'repository',
      'downloadUrl',
      'mirrors',
      'aureole.registry',
    ]) {
      expect(persisted).not.toContain(forbidden);
    }
  });

  it('respects refreshHours and avoids per-Cron polling', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(snapshot(), now);
    const fetcher = canonicalFetcher();
    await refreshDownloadCenterResolvedState(env(kv), { fetcher, now: () => now });
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher,
      now: () => now + 23 * 60 * 60 * 1000,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('keeps valid same-config LKG after GitHub failure and expires it', async () => {
    const now = 1_000_000;
    const config = snapshot([rawItem({ refreshHours: 1, maxStaleHours: 2 })]);
    const kv = await kvWithConfig(config, now);
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: canonicalFetcher(),
      now: () => now,
    });
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream', { status: 500 })),
      now: () => now + 60 * 60 * 1000,
    });
    expect(await readAvailableDownloads(kv.binding(), now + 2 * 60 * 60 * 1000)).toHaveLength(1);
    expect(await readAvailableDownloads(kv.binding(), now + 2 * 60 * 60 * 1000 + 1)).toEqual([]);
  });

  it('records unavailable attempts without retry loops', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(snapshot(), now);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      githubRelease('clash-verge-rev/clash-verge-rev', ['wrong.exe'])
    );
    await refreshDownloadCenterResolvedState(env(kv), { fetcher, now: () => now });
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher,
      now: () => now + 1_000,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await readAvailableDownloads(kv.binding(), now + 1_000)).toEqual([]);
  });

  it('deduplicates the canonical seven items into three repository requests', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(snapshot(canonicalItems()), now);
    const fetcher = canonicalFetcher();
    const result = await refreshDownloadCenterResolvedState(env(kv), {
      fetcher,
      now: () => now,
    });
    expect(result).toEqual({ ok: true, resolved: 7, unavailable: 0 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new Set(fetcher.mock.calls.map((call) => String(call[0]))).size).toBe(3);
    const available = await readAvailableDownloads(kv.binding(), now);
    expect(available).toHaveLength(7);
    expect(available.some((entry) => (entry.platform as string) === 'ios')).toBe(false);
  });

  it('deduplicates normalized repository case variants within one run', async () => {
    const now = 1_000_000;
    const items = [
      rawItem(),
      rawItem({
        id: 'linux-deb-x64',
        label: { default: 'Debian / Ubuntu' },
        platform: 'linux',
        github: {
          repository: 'Clash-Verge-Rev/Clash-Verge-Rev',
          release: 'latest',
          assetMatch: {
            prefix: null,
            suffix: '_amd64.deb',
            contains: [],
            include: [],
            exclude: [],
          },
        },
      }),
    ];
    const kv = await kvWithConfig(snapshot(items), now);
    const fetcher = canonicalFetcher();
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher,
      now: () => now,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await readAvailableDownloads(kv.binding(), now)).toHaveLength(2);
  });

  it('keeps different repositories independent when Mac resolution fails', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(snapshot(canonicalItems()), now);
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: canonicalFetcher({ failMac: true }),
      now: () => now,
    });
    const ids = (await readAvailableDownloads(kv.binding(), now)).map((entry) => entry.id);
    expect(ids).not.toContain('macos');
    expect(ids).toEqual(expect.arrayContaining(['windows', 'android', 'linux-deb-x64']));
    expect(ids).toHaveLength(6);
  });

  it('omits one unmatched Linux variant without removing sibling items', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(snapshot(canonicalItems()), now);
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: canonicalFetcher({
        clashAssets: clashAssets.filter((name) => !name.endsWith('.aarch64.rpm')),
      }),
      now: () => now,
    });
    const ids = (await readAvailableDownloads(kv.binding(), now)).map((entry) => entry.id);
    expect(ids).not.toContain('linux-rpm-arm64');
    expect(ids).toEqual(
      expect.arrayContaining([
        'windows',
        'linux-deb-x64',
        'linux-deb-arm64',
        'linux-rpm-x64',
        'macos',
        'android',
      ])
    );
  });

  it('regenerates URLs when selected provider configuration changes', async () => {
    const now = 1_000_000;
    const initial = snapshot();
    const kv = await kvWithConfig(initial, now);
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: canonicalFetcher(),
      now: () => now,
    });

    const changed = snapshot(
      [rawItem()],
      [
        { ...providers[1] },
        { ...providers[0], baseUrl: 'https://new-proxy.example/' },
      ],
      ['gh-proxy-public', 'hubproxy-self']
    );
    await writeRegistrySnapshot(kv, changed, now + 1);
    const fetcher = canonicalFetcher();
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher,
      now: () => now + 1,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [updated] = await readAvailableDownloads(kv.binding(), now + 1);
    expect(updated.downloads.map((entry) => entry.id)).toEqual([
      'gh-proxy-public',
      'hubproxy-self',
    ]);
    expect(updated.downloads[1].url.startsWith('https://new-proxy.example/')).toBe(true);
  });

  it('does not retain old provider URLs when changed provider config cannot resolve', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(snapshot(), now);
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: canonicalFetcher(),
      now: () => now,
    });
    const changed = snapshot(
      [rawItem()],
      [{ ...providers[0], baseUrl: 'https://new-proxy.example/' }, providers[1]]
    );
    await writeRegistrySnapshot(kv, changed, now + 1);
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream', { status: 500 })),
      now: () => now + 1,
    });
    expect(await readAvailableDownloads(kv.binding(), now + 1)).toEqual([]);
  });

  it('removes absent items and clears output when Registry state is unavailable', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(snapshot(), now);
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: canonicalFetcher(),
      now: () => now,
    });
    await writeRegistrySnapshot(kv, snapshot([]), now + 1);
    await refreshDownloadCenterResolvedState(env(kv), { now: () => now + 1 });
    expect(await readAvailableDownloads(kv.binding(), now + 1)).toEqual([]);
    kv.values.delete(REGISTRY_SNAPSHOT_KEY);
    await refreshDownloadCenterResolvedState(env(kv), { now: () => now + 2 });
    expect(await readAvailableDownloads(kv.binding(), now + 2)).toEqual([]);
  });

  it('fails old schema v1 closed and rebuilds under the same fixed key', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(snapshot(), now);
    kv.values.set(
      DOWNLOAD_CENTER_RESOLVED_KEY,
      JSON.stringify({ schemaVersion: 1, generatedAt: now, items: [] })
    );
    expect(await loadDownloadCenterResolvedState(kv.binding())).toEqual({
      status: 'corrupt',
    });
    await refreshDownloadCenterResolvedState(env(kv), {
      fetcher: canonicalFetcher(),
      now: () => now,
    });
    expect(await readAvailableDownloads(kv.binding(), now)).toHaveLength(1);
  });

  it('calls only api.github.com and sends no provider request or token', async () => {
    const now = 1_000_000;
    const kv = await kvWithConfig(snapshot(), now);
    const fetcher = canonicalFetcher();
    await refreshDownloadCenterResolvedState(env(kv), { fetcher, now: () => now });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(String(url)).hostname).toBe('api.github.com');
    expect(new Headers((init as RequestInit).headers).has('authorization')).toBe(false);
  });
});
