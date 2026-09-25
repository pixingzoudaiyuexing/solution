import { describe, expect, it } from 'vitest';
import type { GitHubLatestRelease } from '../src/adapters/github/releases';
import {
  DownloadResolutionError,
  assetMatches,
  isSafeGitHubDownloadUrl,
  resolveDownloadItem,
  selectReleaseAsset,
} from '../src/registry/download-center-resolution';
import {
  downloadCenterSnapshotSchema,
  getDefaultDownloadProviders,
} from '../src/registry/modules/download-center';

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

function config(suffix = '_x64-setup.exe') {
  const snapshot = downloadCenterSnapshotSchema.parse({
    downloadProviders: providers,
    defaultDownloadProviderIds: ['hubproxy-self', 'gh-proxy-public'],
    items: [
      {
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
            suffix,
            contains: [],
            include: [],
            exclude: [],
          },
        },
        refreshHours: 24,
        maxStaleHours: 168,
      },
    ],
  });
  return {
    item: snapshot.items[0],
    providers: getDefaultDownloadProviders(snapshot),
  };
}

function release(assets: GitHubLatestRelease['assets']): GitHubLatestRelease {
  return {
    repository: { owner: 'clash-verge-rev', repo: 'clash-verge-rev' },
    tagName: 'v2.5.5',
    publishedAt: '2026-09-25T00:00:00.000Z',
    assets,
  };
}

const asset = (name: string, url?: string) => ({
  name,
  downloadUrl:
    url ??
    `https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.5.5/${name}`,
  sizeBytes: 123,
});

describe('deterministic Download Center resolution', () => {
  it('keeps strict case-insensitive literal matcher semantics', () => {
    const matcher = {
      prefix: 'clash',
      suffix: '.exe',
      contains: ['2.5.5'],
      include: ['x64', 'amd64'],
      exclude: ['sha256', 'symbols'],
    };
    expect(assetMatches('CLASH.VERGE_2.5.5_X64-SETUP.EXE', matcher)).toBe(true);
    expect(assetMatches('clash-verge_2.5.5_arm64.exe', matcher)).toBe(false);
    expect(assetMatches('clash-verge_2.5.5_x64-symbols.exe', matcher)).toBe(false);
  });

  it.each([
    ['Windows', '_x64-setup.exe', 'Clash.Verge_2.5.5_x64-setup.exe'],
    ['Mac', 'ClashX.Meta.zip', 'ClashX.Meta.zip'],
    ['Android', '-meta-universal-release.apk', 'cmfa-2.11.4-meta-universal-release.apk'],
    ['Linux deb x64', '_amd64.deb', 'clash-verge_2.5.5_amd64.deb'],
    ['Linux deb arm64', '_arm64.deb', 'clash-verge_2.5.5_arm64.deb'],
    ['Linux rpm x64', '.x86_64.rpm', 'clash-verge-2.5.5.x86_64.rpm'],
    ['Linux rpm arm64', '.aarch64.rpm', 'clash-verge-2.5.5.aarch64.rpm'],
  ])('matches the canonical %s suffix', (_case, suffix, filename) => {
    expect(assetMatches(filename, config(suffix).item.github.assetMatch)).toBe(true);
  });

  it('fails for zero or multiple candidates without array-order selection', () => {
    const matcher = config().item.github.assetMatch;
    expect(() => selectReleaseAsset([asset('other.exe')], matcher)).toThrowError(
      expect.objectContaining<Partial<DownloadResolutionError>>({ code: 'NO_MATCH' })
    );
    expect(() =>
      selectReleaseAsset(
        [
          asset('one_x64-setup.exe'),
          asset('two_x64-setup.exe'),
        ],
        matcher
      )
    ).toThrowError(
      expect.objectContaining<Partial<DownloadResolutionError>>({
        code: 'AMBIGUOUS_MATCH',
      })
    );
  });

  it.each([
    'http://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.5.5/Clash.Verge_2.5.5_x64-setup.exe',
    'https://user@github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.5.5/Clash.Verge_2.5.5_x64-setup.exe',
    'https://objects.githubusercontent.com/clash-verge-rev/clash-verge-rev/releases/download/v2.5.5/Clash.Verge_2.5.5_x64-setup.exe',
    'https://github.com/other/repo/releases/download/v2.5.5/Clash.Verge_2.5.5_x64-setup.exe',
    'https://github.com/clash-verge-rev/clash-verge-rev/releases/download/other/Clash.Verge_2.5.5_x64-setup.exe',
    'https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.5.5/other.exe',
  ])('rejects unsafe selected download URL %s', (url) => {
    expect(
      isSafeGitHubDownloadUrl({
        url,
        repository: 'clash-verge-rev/clash-verge-rev',
        tag: 'v2.5.5',
        filename: 'Clash.Verge_2.5.5_x64-setup.exe',
      })
    ).toBe(false);
  });

  it('returns exactly two provider URLs in configured order without old fields', () => {
    const source = asset('Clash.Verge_2.5.5_x64-setup.exe');
    const selected = config();
    const resolved = resolveDownloadItem(
      selected.item,
      release([source]),
      selected.providers
    );
    expect(resolved).toEqual({
      id: 'windows',
      label: 'Windows',
      platform: 'windows',
      arch: 'x64',
      version: 'v2.5.5',
      publishedAt: '2026-09-25T00:00:00.000Z',
      filename: 'Clash.Verge_2.5.5_x64-setup.exe',
      sizeBytes: 123,
      downloads: [
        {
          id: 'hubproxy-self',
          label: '高速下载',
          url: `https://git.hubproxy.top/${source.downloadUrl}`,
        },
        {
          id: 'gh-proxy-public',
          label: '备用下载',
          url: `https://gh-proxy.com/${source.downloadUrl}`,
        },
      ],
    });
    expect('downloadUrl' in resolved).toBe(false);
    expect('mirrors' in resolved).toBe(false);
    expect(resolved.downloads.every((entry) => entry.url !== source.downloadUrl)).toBe(true);
    expect(resolved.downloads.every((entry) => entry.url.endsWith(source.downloadUrl))).toBe(true);
  });
});
