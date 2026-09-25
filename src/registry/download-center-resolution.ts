import type {
  GitHubLatestRelease,
  GitHubReleaseAsset,
} from '../adapters/github/releases';
import type { DownloadItem } from '../contract/v1/downloads';
import {
  parseGitHubRepository,
  renderGithubUrlPrefixDownload,
  type DownloadCenterItemConfig,
  type SelectedDownloadProviders,
} from './modules/download-center';

export type DownloadResolutionErrorCode =
  | 'NO_MATCH'
  | 'AMBIGUOUS_MATCH'
  | 'UNSAFE_DOWNLOAD_URL';

export class DownloadResolutionError extends Error {
  constructor(readonly code: DownloadResolutionErrorCode) {
    super(`Download asset resolution failed: ${code}`);
    this.name = 'DownloadResolutionError';
  }
}

function includesLiteral(filename: string, literal: string): boolean {
  return filename.includes(literal.toLowerCase());
}

export function assetMatches(
  assetName: string,
  matcher: DownloadCenterItemConfig['github']['assetMatch']
): boolean {
  const filename = assetName.toLowerCase();
  if (matcher.prefix !== null && !filename.startsWith(matcher.prefix.toLowerCase())) {
    return false;
  }
  if (matcher.suffix !== null && !filename.endsWith(matcher.suffix.toLowerCase())) {
    return false;
  }
  if (!matcher.contains.every((literal) => includesLiteral(filename, literal))) {
    return false;
  }
  if (
    matcher.include.length > 0 &&
    !matcher.include.some((literal) => includesLiteral(filename, literal))
  ) {
    return false;
  }
  if (matcher.exclude.some((literal) => includesLiteral(filename, literal))) {
    return false;
  }
  return true;
}

export function selectReleaseAsset(
  assets: readonly GitHubReleaseAsset[],
  matcher: DownloadCenterItemConfig['github']['assetMatch']
): GitHubReleaseAsset {
  const matches = assets.filter((asset) => assetMatches(asset.name, matcher));
  if (matches.length === 0) throw new DownloadResolutionError('NO_MATCH');
  if (matches.length !== 1) throw new DownloadResolutionError('AMBIGUOUS_MATCH');
  return matches[0];
}

export function isSafeGitHubDownloadUrl(input: {
  url: string;
  repository: string;
  tag: string;
  filename: string;
}): boolean {
  const repository = parseGitHubRepository(input.repository);
  if (!repository) return false;
  try {
    const url = new URL(input.url);
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'github.com' ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return false;
    }
    const segments = url.pathname.split('/').filter(Boolean).map((segment) =>
      decodeURIComponent(segment)
    );
    if (
      segments.length < 6 ||
      segments[0].toLowerCase() !== repository.owner.toLowerCase() ||
      segments[1].toLowerCase() !== repository.repo.toLowerCase() ||
      segments[2] !== 'releases' ||
      segments[3] !== 'download' ||
      segments.at(-1) !== input.filename ||
      segments.slice(4, -1).join('/') !== input.tag
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function resolveDownloadItem(
  config: DownloadCenterItemConfig,
  release: GitHubLatestRelease,
  providers: SelectedDownloadProviders
): DownloadItem {
  const asset = selectReleaseAsset(release.assets, config.github.assetMatch);
  if (
    !isSafeGitHubDownloadUrl({
      url: asset.downloadUrl,
      repository: config.github.repository,
      tag: release.tagName,
      filename: asset.name,
    })
  ) {
    throw new DownloadResolutionError('UNSAFE_DOWNLOAD_URL');
  }
  return {
    id: config.id,
    label: config.label.default,
    platform: config.platform,
    arch: config.arch ?? null,
    version: release.tagName,
    publishedAt: release.publishedAt,
    filename: asset.name,
    sizeBytes: asset.sizeBytes,
    downloads: providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      url: renderGithubUrlPrefixDownload(provider.baseUrl, asset.downloadUrl),
    })) as DownloadItem['downloads'],
  };
}
