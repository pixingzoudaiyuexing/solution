import { describe, expect, it } from 'vitest';
import type { GitHubLatestRelease } from '../src/adapters/github/releases';
import {
  DownloadResolutionError,
  assetMatches,
  isSafeGitHubDownloadUrl,
  resolveDownloadItem,
  selectReleaseAsset,
} from '../src/registry/download-center-resolution';
import { downloadCenterSnapshotSchema } from '../src/registry/modules/download-center';

const matcher = {
  prefix: null,
  suffix: '.dmg',
  contains: ['client'],
  include: ['arm64', 'aarch64'],
  exclude: ['sha256', 'symbols'],
};

function config() {
  return downloadCenterSnapshotSchema.parse({
    items: [
      {
        id: 'desktop-client',
        label: { default: 'Desktop Client' },
        audience: 'public',
        platform: 'macos',
        arch: 'arm64',
        github: { repository: 'owner/repo', release: 'latest', assetMatch: matcher },
        refreshHours: 24,
        maxStaleHours: 168,
        mirrors: [
          {
            id: 'mirror-a',
            label: 'Mirror A',
            template: 'https://mirror.example/{owner}/{repo}/{tag}/{filename}',
          },
        ],
      },
    ],
  }).items[0];
}

function release(assets: GitHubLatestRelease['assets']): GitHubLatestRelease {
  return {
    repository: { owner: 'owner', repo: 'repo' },
    tagName: 'v1.2.3',
    publishedAt: '2026-09-25T00:00:00.000Z',
    assets,
  };
}

const asset = (name: string, url?: string) => ({
  name,
  downloadUrl:
    url ?? `https://github.com/owner/repo/releases/download/v1.2.3/${name}`,
  sizeBytes: 123,
});

describe('deterministic Download Center resolution', () => {
  it('applies case-insensitive literal prefix/suffix/contains/include/exclude semantics', () => {
    expect(assetMatches('CLIENT-ARM64.DMG', matcher)).toBe(true);
    expect(assetMatches('client-x64.dmg', matcher)).toBe(false);
    expect(assetMatches('client-arm64-symbols.dmg', matcher)).toBe(false);
    expect(assetMatches('arm64.dmg', matcher)).toBe(false);
  });

  it('returns the only matching asset regardless of source array position', () => {
    const selected = selectReleaseAsset(
      [asset('client-x64.dmg'), asset('client-arm64.dmg'), asset('client-arm64.sha256')],
      matcher
    );
    expect(selected.name).toBe('client-arm64.dmg');
  });

  it('fails for zero matches and never selects the first asset', () => {
    expect(() => selectReleaseAsset([asset('client-x64.dmg')], matcher)).toThrowError(
      expect.objectContaining<Partial<DownloadResolutionError>>({ code: 'NO_MATCH' })
    );
  });

  it('fails for multiple matches without using array order as a tiebreaker', () => {
    expect(() =>
      selectReleaseAsset([asset('client-arm64.dmg'), asset('client-aarch64.dmg')], matcher)
    ).toThrowError(
      expect.objectContaining<Partial<DownloadResolutionError>>({ code: 'AMBIGUOUS_MATCH' })
    );
  });

  it.each([
    'http://github.com/owner/repo/releases/download/v1.2.3/client-arm64.dmg',
    'https://user@github.com/owner/repo/releases/download/v1.2.3/client-arm64.dmg',
    'https://objects.githubusercontent.com/owner/repo/releases/download/v1.2.3/client-arm64.dmg',
    'https://github.com/other/repo/releases/download/v1.2.3/client-arm64.dmg',
    'https://github.com/owner/repo/releases/download/other/client-arm64.dmg',
    'https://github.com/owner/repo/releases/download/v1.2.3/other.dmg',
    'https://github.com/owner/repo/releases/download/v1.2.3/client-arm64.dmg?token=x',
  ])('rejects unsafe selected download URL %s', (url) => {
    expect(
      isSafeGitHubDownloadUrl({
        url,
        repository: 'owner/repo',
        tag: 'v1.2.3',
        filename: 'client-arm64.dmg',
      })
    ).toBe(false);
  });

  it('creates the exact neutral DTO and rendered mirror URLs', () => {
    expect(resolveDownloadItem(config(), release([asset('client-arm64.dmg')]))).toEqual({
      id: 'desktop-client',
      label: 'Desktop Client',
      platform: 'macos',
      arch: 'arm64',
      version: 'v1.2.3',
      publishedAt: '2026-09-25T00:00:00.000Z',
      downloadUrl:
        'https://github.com/owner/repo/releases/download/v1.2.3/client-arm64.dmg',
      filename: 'client-arm64.dmg',
      sizeBytes: 123,
      mirrors: [
        {
          id: 'mirror-a',
          label: 'Mirror A',
          url: 'https://mirror.example/owner/repo/v1.2.3/client-arm64.dmg',
        },
      ],
    });
  });
});
