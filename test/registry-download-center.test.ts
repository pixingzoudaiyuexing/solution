import { describe, expect, it } from 'vitest';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import {
  REGISTRY_CATEGORY,
  RegistryValidationState,
  validateRegistryKnowledge,
} from '../src/registry/kernel';
import {
  DOWNLOAD_CENTER_MAX_ITEMS,
  DOWNLOAD_CENTER_MAX_MATCHER_ENTRIES,
  DOWNLOAD_CENTER_MAX_PROVIDERS,
  DOWNLOAD_CENTER_MAX_STALE_AGE_SECONDS,
  downloadCenterConfigSchema,
  downloadCenterOperationalDefinition,
  downloadCenterRegistryDefinition,
  getDefaultDownloadProviders,
  renderGithubUrlPrefixDownload,
} from '../src/registry/modules/download-center';

const downloadProviders = [
  {
    id: 'hubproxy-self',
    enabled: true,
    label: '高速下载',
    type: 'github-url-prefix',
    baseUrl: 'https://git.hubproxy.top/',
  },
  {
    id: 'gh-proxy-public',
    enabled: true,
    label: '备用下载',
    type: 'github-url-prefix',
    baseUrl: 'https://gh-proxy.com/',
  },
] as const;

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'windows',
    enabled: true,
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

function config(overrides: Record<string, unknown> = {}) {
  return {
    downloadProviders: downloadProviders.map((provider) => ({ ...provider })),
    defaultDownloadProviderIds: ['hubproxy-self', 'gh-proxy-public'],
    items: [item()],
    ...overrides,
  };
}

function canonicalItems() {
  const clashRepository = 'clash-verge-rev/clash-verge-rev';
  const { arch: _macArch, ...macBase } = item();
  return [
    item(),
    {
      ...macBase,
      id: 'macos',
      label: { default: 'Mac' },
      platform: 'macos',
      github: {
        repository: 'MetaCubeX/ClashX.Meta',
        release: 'latest',
        assetMatch: {
          prefix: null,
          suffix: 'ClashX.Meta.zip',
          contains: [],
          include: [],
          exclude: [],
        },
      },
    },
    item({
      id: 'android',
      label: { default: 'Android' },
      platform: 'android',
      arch: 'universal',
      github: {
        repository: 'MetaCubeX/ClashMetaForAndroid',
        release: 'latest',
        assetMatch: {
          prefix: null,
          suffix: '-meta-universal-release.apk',
          contains: [],
          include: [],
          exclude: [],
        },
      },
    }),
    ...[
      ['linux-deb-x64', 'Debian / Ubuntu', 'x64', '_amd64.deb'],
      ['linux-deb-arm64', 'Debian / Ubuntu', 'arm64', '_arm64.deb'],
      ['linux-rpm-x64', 'Fedora / RHEL', 'x64', '.x86_64.rpm'],
      ['linux-rpm-arm64', 'Fedora / RHEL', 'arm64', '.aarch64.rpm'],
    ].map(([id, label, arch, suffix]) =>
      item({
        id,
        label: { default: label },
        platform: 'linux',
        arch,
        github: {
          repository: clashRepository,
          release: 'latest',
          assetMatch: {
            prefix: null,
            suffix,
            contains: [],
            include: [],
            exclude: [],
          },
        },
      })
    ),
  ];
}

function registryBody(value: unknown): string {
  return JSON.stringify({
    kind: 'aureole.registry',
    moduleId: 'download-center',
    schemaVersion: 1,
    enabled: true,
    config: value,
  });
}

describe('M03 download-center Registry definition', () => {
  it('uses public schema v1 with bounded providers, items and freshness', () => {
    expect(downloadCenterRegistryDefinition).toMatchObject({
      moduleId: 'download-center',
      schemaVersion: 1,
      maximumExposure: 'public',
    });
    expect(downloadCenterOperationalDefinition.freshness).toEqual({
      class: 'STALE_TOLERANT',
      maxStaleAgeSeconds: 604_800,
    });
    expect({
      items: DOWNLOAD_CENTER_MAX_ITEMS,
      providers: DOWNLOAD_CENTER_MAX_PROVIDERS,
      matcherEntries: DOWNLOAD_CENTER_MAX_MATCHER_ENTRIES,
      staleSeconds: DOWNLOAD_CENTER_MAX_STALE_AGE_SECONDS,
    }).toEqual({
      items: 50,
      providers: 8,
      matcherEntries: 8,
      staleSeconds: 604_800,
    });
    expect(
      registryOperationalDefinitions.some(
        (definition) => definition.registryDefinition.moduleId === 'download-center'
      )
    ).toBe(true);
  });

  it('accepts the canonical Windows, Mac, Android and four Linux items without iOS', () => {
    const parsed = downloadCenterConfigSchema.parse(
      config({ items: canonicalItems() })
    );
    expect(parsed.defaultDownloadProviderIds).toEqual([
      'hubproxy-self',
      'gh-proxy-public',
    ]);
    expect(parsed.items.map(({ id, label, platform, arch }) => ({
      id,
      label: label.default,
      platform,
      arch: arch ?? null,
    }))).toEqual([
      { id: 'windows', label: 'Windows', platform: 'windows', arch: 'x64' },
      { id: 'macos', label: 'Mac', platform: 'macos', arch: null },
      { id: 'android', label: 'Android', platform: 'android', arch: 'universal' },
      { id: 'linux-deb-x64', label: 'Debian / Ubuntu', platform: 'linux', arch: 'x64' },
      { id: 'linux-deb-arm64', label: 'Debian / Ubuntu', platform: 'linux', arch: 'arm64' },
      { id: 'linux-rpm-x64', label: 'Fedora / RHEL', platform: 'linux', arch: 'x64' },
      { id: 'linux-rpm-arm64', label: 'Fedora / RHEL', platform: 'linux', arch: 'arm64' },
    ]);
    expect(parsed.items.some((entry) => entry.platform === ('ios' as never))).toBe(false);
  });

  it.each([
    'owner',
    'owner/repo/extra',
    '/owner/repo',
    'owner//repo',
    'owner/../repo',
    'https://github.com/owner/repo',
    'owner/repo?x=1',
    'owner/repo#fragment',
    'owner\\repo',
  ])('rejects unsafe repository form %s', (repository) => {
    expect(
      downloadCenterConfigSchema.safeParse(
        config({
          items: [
            item({
              github: { ...item().github, repository },
            }),
          ],
        })
      ).success
    ).toBe(false);
  });

  it.each([
    'http://git.hubproxy.top/',
    'https://user:pass@git.hubproxy.top/',
    'https://git.hubproxy.top/path',
    'https://git.hubproxy.top/?query=1',
    'https://git.hubproxy.top/#fragment',
    'https://git.hubproxy.top/{url}',
    'https://git.hubproxy.top/${url}/',
    'https://github.com/',
    'javascript:alert(1)',
  ])('rejects unsafe provider base URL %s', (baseUrl) => {
    expect(
      downloadCenterConfigSchema.safeParse(
        config({
          downloadProviders: [
            { ...downloadProviders[0], baseUrl },
            { ...downloadProviders[1] },
          ],
        })
      ).success
    ).toBe(false);
  });

  it.each([
    ['duplicate provider IDs', config({ downloadProviders: [downloadProviders[0], downloadProviders[0]] })],
    ['duplicate defaults', config({ defaultDownloadProviderIds: ['hubproxy-self', 'hubproxy-self'] })],
    ['missing provider reference', config({ defaultDownloadProviderIds: ['hubproxy-self', 'missing'] })],
    ['disabled provider reference', config({ downloadProviders: [{ ...downloadProviders[0] }, { ...downloadProviders[1], enabled: false }] })],
    ['unsupported provider type', config({ downloadProviders: [{ ...downloadProviders[0], type: 'template' }, downloadProviders[1]] })],
    ['unknown provider field', config({ downloadProviders: [{ ...downloadProviders[0], template: '{url}' }, downloadProviders[1]] })],
    ['too many providers', config({ downloadProviders: Array.from({ length: 9 }, (_, index) => ({ ...downloadProviders[0], id: `provider-${index}`, baseUrl: `https://provider-${index}.example/` })), defaultDownloadProviderIds: ['provider-0', 'provider-1'] })],
    ['one default provider', config({ defaultDownloadProviderIds: ['hubproxy-self'] })],
    ['three default providers', config({ defaultDownloadProviderIds: ['hubproxy-self', 'gh-proxy-public', 'extra'] })],
    ['old mirrors field', config({ items: [item({ mirrors: [] })] })],
    ['per-item provider override', config({ items: [item({ downloadProviderIds: ['hubproxy-self', 'gh-proxy-public'] })] })],
    ['iOS platform', config({ items: [item({ id: 'ios', platform: 'ios' })] })],
    ['arbitrary regex field', config({ items: [item({ github: { ...item().github, assetMatch: { ...item().github.assetMatch, regex: '.*' } } })] })],
    ['stale lower than refresh', config({ items: [item({ refreshHours: 25, maxStaleHours: 24 })] })],
  ])('rejects %s', (_case, value) => {
    expect(downloadCenterConfigSchema.safeParse(value).success).toBe(false);
  });

  it('renders provider prefixes without encoding the validated GitHub URL', () => {
    const source =
      'https://github.com/clash-verge-rev/clash-verge-rev/releases/download/v2.5.5/Clash.Verge_2.5.5_x64-setup.exe';
    expect(renderGithubUrlPrefixDownload('https://git.hubproxy.top/', source)).toBe(
      `https://git.hubproxy.top/${source}`
    );
    expect(renderGithubUrlPrefixDownload('https://gh-proxy.com/', source)).toBe(
      `https://gh-proxy.com/${source}`
    );
  });

  it('projects only enabled providers/items and preserves selected provider order', () => {
    const parsed = downloadCenterConfigSchema.parse(
      config({
        downloadProviders: [
          ...downloadProviders.map((provider) => ({ ...provider })),
          {
            id: 'disabled-provider',
            enabled: false,
            label: 'Disabled',
            type: 'github-url-prefix',
            baseUrl: 'https://disabled.example/',
          },
        ],
        items: [item(), item({ id: 'disabled-item', enabled: false })],
      })
    );
    const projected = downloadCenterOperationalDefinition.projectSnapshot(parsed);
    expect(projected.downloadProviders.map((provider) => provider.id)).toEqual([
      'hubproxy-self',
      'gh-proxy-public',
    ]);
    expect(projected.items.map((entry) => entry.id)).toEqual(['windows']);
    expect(getDefaultDownloadProviders(projected).map((provider) => provider.id)).toEqual([
      'hubproxy-self',
      'gh-proxy-public',
    ]);
    expect(JSON.stringify(projected)).not.toContain('enabled');
  });

  it('rejects duplicate item IDs through the Registry kernel', () => {
    const duplicate = item();
    const report = validateRegistryKnowledge(
      [
        {
          sourceId: 1,
          category: REGISTRY_CATEGORY,
          title: 'registry:download-center',
          show: 1,
          updatedAt: 100,
          body: registryBody(config({ items: [duplicate, duplicate] })),
        },
      ],
      [downloadCenterRegistryDefinition]
    );
    expect(report.modules[0]).toMatchObject({
      state: RegistryValidationState.INVALID_SCHEMA,
      code: 'DUPLICATE_ITEM_ID',
    });
  });
});
