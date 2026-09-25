import type { Env } from '../config/env';
import { GitHubReleasesAdapter } from '../adapters/github/releases';
import { registryOperationalDefinitions } from './definitions';
import {
  downloadCenterOperationalDefinition,
  getDefaultDownloadProviders,
  normalizedGitHubRepositoryKey,
  type DownloadCenterItemConfig,
} from './modules/download-center';
import { readRegistryModuleSnapshot } from './operational';
import { resolveDownloadItem } from './download-center-resolution';
import {
  DOWNLOAD_CENTER_RESOLVED_SCHEMA_VERSION,
  downloadCenterConfigFingerprint,
  loadDownloadCenterResolvedState,
  persistDownloadCenterResolvedState,
  type DownloadCenterResolvedEntry,
} from './download-center-resolved';

export type DownloadCenterRefreshResult =
  | { ok: true; resolved: number; unavailable: number }
  | { ok: false; code: 'KV_UNAVAILABLE' };

export interface DownloadCenterRefreshOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid Download Center clock');
  }
  return value;
}

function sameConfig(
  previous: DownloadCenterResolvedEntry | undefined,
  fingerprint: string
): previous is DownloadCenterResolvedEntry {
  return previous?.configFingerprint === fingerprint;
}

function resolutionDue(
  previous: DownloadCenterResolvedEntry | undefined,
  item: DownloadCenterItemConfig,
  now: number
): boolean {
  if (!previous || previous.lastAttemptAt > now) return true;
  return now - previous.lastAttemptAt >= item.refreshHours * 60 * 60 * 1000;
}

export async function refreshDownloadCenterResolvedState(
  env: Env,
  options: DownloadCenterRefreshOptions = {}
): Promise<DownloadCenterRefreshResult> {
  const kv = env.REGISTRY_KV;
  if (!kv) return { ok: false, code: 'KV_UNAVAILABLE' };
  const now = safeNow(options.now ?? Date.now);
  const snapshot = await readRegistryModuleSnapshot(
    kv,
    downloadCenterOperationalDefinition,
    now,
    registryOperationalDefinitions
  );

  if (snapshot.status !== 'available') {
    try {
      await persistDownloadCenterResolvedState(kv, {
        schemaVersion: DOWNLOAD_CENTER_RESOLVED_SCHEMA_VERSION,
        generatedAt: now,
        items: [],
      });
      return { ok: true, resolved: 0, unavailable: 0 };
    } catch {
      return { ok: false, code: 'KV_UNAVAILABLE' };
    }
  }

  const loaded = await loadDownloadCenterResolvedState(kv);
  const previousItems =
    loaded.status === 'valid' && loaded.state.generatedAt <= now
      ? loaded.state.items
      : [];
  const adapter = new GitHubReleasesAdapter(
    options.fetcher ?? fetch,
    options.timeoutMs
  );
  const selectedProviders = getDefaultDownloadProviders(snapshot.config);
  const releasesByRepository = new Map<
    string,
    ReturnType<GitHubReleasesAdapter['latest']>
  >();
  const releaseFor = (item: DownloadCenterItemConfig) => {
    const key = normalizedGitHubRepositoryKey(item.github.repository);
    if (key === null) throw new Error('Invalid GitHub repository');
    const existing = releasesByRepository.get(key);
    if (existing) return existing;
    const created = adapter.latest(item.github.repository);
    releasesByRepository.set(key, created);
    return created;
  };
  const nextItems: DownloadCenterResolvedEntry[] = [];

  for (const item of snapshot.config.items) {
    const fingerprint = await downloadCenterConfigFingerprint({
      item,
      downloadProviders: selectedProviders,
    });
    const candidate = previousItems.find((previous) => previous.id === item.id);
    const previous = sameConfig(candidate, fingerprint) ? candidate : undefined;
    if (!resolutionDue(previous, item, now)) {
      nextItems.push(previous!);
      continue;
    }

    try {
      const release = await releaseFor(item);
      const data = resolveDownloadItem(item, release, selectedProviders);
      nextItems.push({
        id: item.id,
        configFingerprint: fingerprint,
        lastAttemptAt: now,
        resolvedAt: now,
        expiresAt: now + item.maxStaleHours * 60 * 60 * 1000,
        data,
      });
    } catch {
      nextItems.push(
        previous
          ? { ...previous, lastAttemptAt: now }
          : {
              id: item.id,
              configFingerprint: fingerprint,
              lastAttemptAt: now,
            }
      );
    }
  }

  try {
    await persistDownloadCenterResolvedState(kv, {
      schemaVersion: DOWNLOAD_CENTER_RESOLVED_SCHEMA_VERSION,
      generatedAt: now,
      items: nextItems,
    });
  } catch {
    return { ok: false, code: 'KV_UNAVAILABLE' };
  }
  return {
    ok: true,
    resolved: nextItems.filter((item) => item.data !== undefined).length,
    unavailable: nextItems.filter((item) => item.data === undefined).length,
  };
}
