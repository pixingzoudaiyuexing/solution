import { describe, expect, it } from 'vitest';
import { downloadCenterConfigSchema, downloadCenterOperationalDefinition,
  getDefaultDownloadProviders } from '../src/registry/modules/download-center';
import { resolveDownloadItem, selectReleaseAsset, DownloadResolutionError } from '../src/registry/download-center-resolution';
import { persistDownloadCenterResolvedState, readAvailableDownloads } from '../src/registry/download-center-resolved';
import { FakeKV } from './helpers/fake-kv';

const providers = [
  { id: 'hubproxy-self', enabled: true, label: 'Fast', type: 'github-url-prefix', baseUrl: 'https://git.hubproxy.top/' },
  { id: 'gh-proxy-public', enabled: true, label: 'Backup', type: 'github-url-prefix', baseUrl: 'https://gh-proxy.com/' },
];
const item = {
  id: 'clashbox-harmonyos', enabled: true, label: { default: 'ClashBox' },
  audience: 'public', platform: 'harmonyos',
  github: { repository: 'xiaobaigroup/ClashBox', release: 'latest',
    assetMatch: { prefix: null, suffix: '.hap', contains: ['ClashBox'], include: [], exclude: [] } },
  refreshHours: 24, maxStaleHours: 168,
};
const config = { downloadProviders: providers, defaultDownloadProviderIds: ['hubproxy-self', 'gh-proxy-public'], items: [item] };
const release = (names: string[]) => ({ repository: { owner: 'xiaobaigroup', repo: 'ClashBox' },
  tagName: 'latest-v1', publishedAt: '2026-09-27T00:00:00.000Z',
  assets: names.map((name) => ({ name, sizeBytes: 123,
    downloadUrl: `https://github.com/xiaobaigroup/ClashBox/releases/download/latest-v1/${name}` })) });

describe('M03 additive ClashBox HarmonyOS catalog', () => {
  it('accepts the stable additive platform without changing existing provider order', async () => {
    const parsed = downloadCenterConfigSchema.parse(config);
    expect(parsed.items[0]).toMatchObject({ id: 'clashbox-harmonyos', platform: 'harmonyos', github: {
      repository: 'xiaobaigroup/ClashBox', release: 'latest',
    } });
    expect(parsed.items[0].arch).toBeUndefined();
    const snapshot = downloadCenterOperationalDefinition.projectSnapshot(parsed);
    expect(snapshot.items[0].arch).toBeUndefined();
    expect(snapshot.defaultDownloadProviderIds).toEqual(['hubproxy-self', 'gh-proxy-public']);
    const result = resolveDownloadItem(snapshot.items[0], release(['ClashBox_LTS_V1_unsigned.hap']), getDefaultDownloadProviders(snapshot));
    expect(result).toMatchObject({ id: 'clashbox-harmonyos', label: 'ClashBox', platform: 'harmonyos', arch: null, downloads: [
      { id: 'hubproxy-self' }, { id: 'gh-proxy-public' },
    ] });
    expect(result.downloads[0].url).toBe(`https://git.hubproxy.top/https://github.com/xiaobaigroup/ClashBox/releases/download/latest-v1/ClashBox_LTS_V1_unsigned.hap`);
    expect(result.downloads[1].url).toBe(`https://gh-proxy.com/https://github.com/xiaobaigroup/ClashBox/releases/download/latest-v1/ClashBox_LTS_V1_unsigned.hap`);
    const kv = new FakeKV(); const now = Date.parse('2026-09-27T00:00:00.000Z');
    await persistDownloadCenterResolvedState(kv.binding(), { schemaVersion: 2, generatedAt: now, items: [{
      id: result.id, configFingerprint: 'a'.repeat(64), lastAttemptAt: now, resolvedAt: now,
      expiresAt: now + 86_400_000, data: result,
    }] });
    expect(await readAvailableDownloads(kv.binding(), now)).toEqual([result]);
  });

  it('matches only one current .hap and fails closed for none or multiple assets', () => {
    const matcher = downloadCenterConfigSchema.parse(config).items[0].github.assetMatch;
    expect(selectReleaseAsset(release(['ClashBox_LTS_V1_unsigned.hap']).assets, matcher).name)
      .toBe('ClashBox_LTS_V1_unsigned.hap');
    for (const names of [['other.apk'], ['ClashBox_A.hap', 'ClashBox_B.hap']]) {
      expect(() => selectReleaseAsset(release(names).assets, matcher)).toThrowError(
        expect.objectContaining<Partial<DownloadResolutionError>>({ code: names.length === 1 ? 'NO_MATCH' : 'AMBIGUOUS_MATCH' })
      );
    }
  });

  it.each(['ios', 'other', 'android-next'])('continues rejecting unknown platform %s', (platform) => {
    expect(downloadCenterConfigSchema.safeParse({ ...config, items: [{ ...item, platform }] }).success).toBe(false);
  });
});
