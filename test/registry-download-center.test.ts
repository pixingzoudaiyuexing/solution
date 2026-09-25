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
  DOWNLOAD_CENTER_MAX_MIRRORS,
  DOWNLOAD_CENTER_MAX_STALE_AGE_SECONDS,
  downloadCenterConfigSchema,
  downloadCenterOperationalDefinition,
  downloadCenterRegistryDefinition,
  isValidMirrorTemplate,
  renderMirrorUrl,
} from '../src/registry/modules/download-center';

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'desktop-client',
    enabled: true,
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
        exclude: ['sha256', 'symbols'],
      },
    },
    refreshHours: 24,
    maxStaleHours: 168,
    mirrors: [
      {
        id: 'mirror-a',
        label: 'Mirror A',
        template: 'https://mirror.example/download/{owner}/{repo}/{tag}/{filename}',
      },
    ],
    ...overrides,
  };
}

function registryBody(config: unknown): string {
  return JSON.stringify({
    kind: 'aureole.registry',
    moduleId: 'download-center',
    schemaVersion: 1,
    enabled: true,
    config,
  });
}

describe('M03 download-center Registry definition', () => {
  it('uses public schema v1 with the frozen hard bounds', () => {
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
      mirrors: DOWNLOAD_CENTER_MAX_MIRRORS,
      matcherEntries: DOWNLOAD_CENTER_MAX_MATCHER_ENTRIES,
      staleSeconds: DOWNLOAD_CENTER_MAX_STALE_AGE_SECONDS,
    }).toEqual({ items: 50, mirrors: 8, matcherEntries: 8, staleSeconds: 604_800 });
    expect(
      registryOperationalDefinitions.some(
        (definition) => definition.registryDefinition.moduleId === 'download-center'
      )
    ).toBe(true);
  });

  it('accepts and normalizes the frozen configuration semantics', () => {
    const parsed = downloadCenterConfigSchema.parse({
      items: [item({ label: { default: ' Desktop Client ' } })],
    });
    expect(parsed.items[0]).toMatchObject({
      id: 'desktop-client',
      label: { default: 'Desktop Client' },
      audience: 'public',
      platform: 'macos',
      arch: 'arm64',
      refreshHours: 24,
      maxStaleHours: 168,
    });
  });

  it.each([
    'owner',
    'owner/repo/extra',
    '/owner/repo',
    'owner//repo',
    'owner/../repo',
    'https://github.com/owner/repo',
    'github.com/owner/repo?x=1',
    'owner/repo#fragment',
    'owner\\repo',
    ' owner/repo',
    'owner/repo ',
  ])('rejects unsafe repository form %s', (repository) => {
    expect(
      downloadCenterConfigSchema.safeParse({
        items: [
          item({
            github: {
              ...(item().github as object),
              repository,
            },
          }),
        ],
      }).success
    ).toBe(false);
  });

  it.each([
    ['unknown config field', { items: [item()], apiUrl: 'https://api.example' }],
    ['unknown item field', { items: [item({ command: 'run()' })] }],
    ['non-public audience', { items: [item({ audience: 'authenticated' })] }],
    ['arbitrary release selector', { items: [item({ github: { ...(item().github as object), release: 'v1' } })] }],
    ['arbitrary regex field', { items: [item({ github: { ...(item().github as object), assetMatch: { ...(item().github as any).assetMatch, regex: '.*' } } })] }],
    ['unsafe label', { items: [item({ label: { default: '<script>' } })] }],
    ['too many matcher entries', { items: [item({ github: { ...(item().github as object), assetMatch: { ...(item().github as any).assetMatch, include: Array(9).fill('x') } } })] }],
    ['stale lower than refresh', { items: [item({ refreshHours: 25, maxStaleHours: 24 })] }],
    ['too many mirrors', { items: [item({ mirrors: Array.from({ length: 9 }, (_, index) => ({ id: `mirror-${index}`, label: 'Mirror', template: 'https://mirror.example/{filename}' })) })] }],
    ['duplicate mirrors', { items: [item({ mirrors: [item().mirrors[0], item().mirrors[0]] })] }],
    ['too many items', { items: Array.from({ length: 51 }, (_, index) => item({ id: `item-${index}` })) }],
  ])('rejects %s', (_case, config) => {
    expect(downloadCenterConfigSchema.safeParse(config).success).toBe(false);
  });

  it.each([
    'http://mirror.example/{filename}',
    'https://user:pass@mirror.example/{filename}',
    'https://mirror.example/{unknown}',
    'https://mirror.example/{filename}/{',
    'https://mirror.example/${javascript:alert(1)}',
    'javascript:alert(1)',
  ])('rejects unsafe mirror template %s', (template) => {
    expect(isValidMirrorTemplate(template)).toBe(false);
    expect(
      downloadCenterConfigSchema.safeParse({
        items: [item({ mirrors: [{ id: 'mirror-a', label: 'Mirror', template }] })],
      }).success
    ).toBe(false);
  });

  it('renders only the fixed placeholder allowlist with encoded values', () => {
    expect(
      renderMirrorUrl(
        'https://mirror.example/{owner}/{repo}/{tag}/{filename}',
        { owner: 'owner', repo: 'repo', tag: 'release/1', filename: 'Client 1.dmg' }
      )
    ).toBe('https://mirror.example/owner/repo/release%2F1/Client%201.dmg');
  });

  it('projects only enabled items and removes the source-only enabled field', () => {
    const config = downloadCenterConfigSchema.parse({
      items: [item(), item({ id: 'disabled-client', enabled: false })],
    });
    const projected = downloadCenterOperationalDefinition.projectSnapshot(config);
    expect(projected.items).toHaveLength(1);
    expect(projected.items[0].id).toBe('desktop-client');
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
          body: registryBody({ items: [duplicate, duplicate] }),
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
