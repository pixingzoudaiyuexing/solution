import { describe, expect, it, vi } from 'vitest';
import { REGISTRY_CATEGORY, RegistryValidationState, validateRegistryKnowledge } from '../src/registry/kernel';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { customPagesRegistryDefinition } from '../src/registry/modules/custom-pages';
import {
  NAVIGATION_CORE_TARGETS, NAVIGATION_DEFAULT_LABELS, navigationConfigSchema,
  navigationOperationalDefinition, navigationRegistryDefinition, navigationSnapshotSchema,
} from '../src/registry/modules/navigation';
import { readRegistryModuleSnapshot } from '../src/registry/operational';
import { refreshRegistryOperationalState } from '../src/registry/refresh';
import { FakeKV } from './helpers/fake-kv';
import { resolveNavigation } from '../src/security/navigation';

const core = () => NAVIGATION_CORE_TARGETS.map((targetId) => ({ kind: 'core' as const, targetId, visible: true }));
const ref = (itemId: string, visible = true) => ({ kind: 'custom-page' as const, target: { moduleId: 'custom-pages' as const, itemId }, visible });
const custom = (id: string, enabled = true) => ({ id, title: { default: id }, mode: 'iframe', url: 'https://example.org/', enabled });
const record = (moduleId: string, config: unknown, enabled = true, sourceId = 1) => ({
  sourceId, category: REGISTRY_CATEGORY, title: `registry:${moduleId}`, show: 1 as const, updatedAt: 100,
  body: JSON.stringify({ kind: 'aureole.registry', moduleId, schemaVersion: 1, enabled, config }),
});

describe('REG-M16 navigation schema and references', () => {
  it('registers an authenticated 24-hour module with only safe projection fields', () => {
    expect(navigationRegistryDefinition).toMatchObject({ moduleId: 'navigation', schemaVersion: 1, maximumExposure: 'authenticated' });
    expect(navigationOperationalDefinition.freshness).toEqual({ class: 'STALE_TOLERANT', maxStaleAgeSeconds: 86_400 });
    expect(NAVIGATION_CORE_TARGETS).toHaveLength(12);
    expect(NAVIGATION_DEFAULT_LABELS.dashboard).toBe('Overview');
    const config = navigationConfigSchema.parse({ items: [...core(), ref('page-a')] });
    expect(navigationRegistryDefinition.getReferences?.(config)).toEqual([{ moduleId: 'custom-pages', itemId: 'page-a' }]);
    const projected = navigationOperationalDefinition.projectSnapshot(config);
    expect(projected.items.at(-1)).toEqual({ kind: 'custom-page', itemId: 'page-a', visible: true });
    expect(JSON.stringify(projected)).not.toContain('moduleId');
  });

  it.each([
    ['dashboard hidden', () => core().map((item) => item.targetId === 'dashboard' ? { ...item, visible: false } : item)],
    ['dashboard missing', () => core().slice(1)],
    ['dashboard duplicated', () => [...core(), core()[0]]],
    ['other core missing', () => core().filter((item) => item.targetId !== 'wallet')],
    ['other core duplicated', () => [...core(), core()[4]]],
    ['unknown target', () => [...core(), { kind: 'core', targetId: 'unknown', visible: true }]],
    ['raw route', () => [...core(), { kind: 'core', targetId: '/dashboard', visible: true }]],
    ['URL target', () => [...core(), { kind: 'core', targetId: 'https://example.org', visible: true }]],
    ['javascript target', () => [...core(), { kind: 'core', targetId: 'javascript:alert(1)', visible: true }]],
    ['account target', () => [...core(), { kind: 'core', targetId: 'account', visible: true }]],
    ['extra field', () => core().map((item, index) => index === 0 ? { ...item, route: '/dashboard' } : item)],
    ['too many items', () => [...core(), ...Array.from({ length: 53 }, (_, i) => ref(`page-${i}`))]],
    ['duplicate custom ref', () => [...core(), ref('page-a'), ref('page-a', false)]],
    ['wrong custom module', () => [...core(), { kind: 'custom-page', target: { moduleId: 'other', itemId: 'page-a' }, visible: true }]],
    ['invalid custom ID', () => [...core(), ref('Bad_ID')]],
  ])('rejects %s', (_case, items) => {
    expect(navigationConfigSchema.safeParse({ items: items() }).success).toBe(false);
  });

  it.each(['', ' ', 'x'.repeat(121), '<b>unsafe</b>', 'bad\u0000label'])('rejects unsafe label %j', (label) => {
    expect(navigationConfigSchema.safeParse({ items: core().map((item, index) => index === 0 ? { ...item, label: { default: label } } : item) }).success).toBe(false);
  });

  it.each(NAVIGATION_CORE_TARGETS.filter((target) => target !== 'dashboard'))('hides %s without changing any other core target', (target) => {
    const parsed = navigationConfigSchema.parse({ items: core().map((item) => item.targetId === target ? { ...item, visible: false } : item) });
    const output = resolveNavigation(navigationOperationalDefinition.projectSnapshot(parsed), null);
    expect(output.some((item) => item.kind === 'core' && item.targetId === target)).toBe(false);
    expect(output.filter((item) => item.kind === 'core')).toHaveLength(11);
  });

  it('uses current Custom Page title without override and omits unavailable references', () => {
    const config = navigationConfigSchema.parse({ items: [ref('page-a'), ref('page-b'), ...core()] });
    const output = resolveNavigation(navigationOperationalDefinition.projectSnapshot(config), {
      items: [{ id: 'page-a', title: 'Current Page Title', mode: 'iframe', url: 'https://example.org/' }],
    });
    expect(output[0]).toEqual({ kind: 'custom-page', itemId: 'page-a', label: 'Current Page Title' });
    expect(output.some((item) => item.kind === 'custom-page' && item.itemId === 'page-b')).toBe(false);
  });

  it('rejects incomplete or poisoned operational snapshots', () => {
    expect(navigationSnapshotSchema.safeParse({ items: core().slice(1) }).success).toBe(false);
    expect(navigationSnapshotSchema.safeParse({ items: [...core(), { kind: 'custom-page', itemId: 'page-a', visible: true, url: 'https://example.org' }] }).success).toBe(false);
  });

  it('validates existing and disabled Custom Page identity, and invalidates missing/removed references', () => {
    const nav = record('navigation', { items: [...core(), ref('page-a'), ref('page-b')] });
    const report = (pages?: unknown, enabled = true) => validateRegistryKnowledge([
      nav,
      ...(pages === undefined ? [] : [record('custom-pages', { items: pages }, enabled, 2)]),
    ], [navigationRegistryDefinition, customPagesRegistryDefinition]);
    expect(report([custom('page-a'), custom('page-b', false)]).modules.find((m) => m.moduleId === 'navigation')?.state).toBe(RegistryValidationState.VALID_ENABLED);
    expect(report([custom('page-a'), custom('page-b', false)], false).modules.find((m) => m.moduleId === 'navigation')?.state).toBe(RegistryValidationState.VALID_ENABLED);
    expect(report([custom('page-a')]).modules.find((m) => m.moduleId === 'navigation')?.state).toBe(RegistryValidationState.DEPENDENCY_INVALID);
    expect(report().modules.find((m) => m.moduleId === 'navigation')?.state).toBe(RegistryValidationState.DEPENDENCY_INVALID);
  });

  it('keeps previous validated LKG after invalid source and expires it after 24 hours', async () => {
    const kv = new FakeKV();
    let navigation = record('navigation', { items: [...core(), ref('page-a')] });
    const pages = record('custom-pages', { items: [custom('page-a')] }, true, 2);
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const records = [navigation, pages];
      if (url.searchParams.has('id')) {
        const entry = records.find((item) => item.sourceId === Number(url.searchParams.get('id')))!;
        return new Response(JSON.stringify({ data: { id: entry.sourceId, title: entry.title, category: entry.category, show: 1, updated_at: 100, body: entry.body } }));
      }
      return new Response(JSON.stringify({ data: records.map((item) => ({ id: item.sourceId, title: item.title, category: item.category, show: 1, updated_at: 100 })) }));
    });
    const env = { REGISTRY_KV: kv.binding(), V2BOARD_BASE_URL: 'https://upstream.example/api/v1/', V2BOARD_CONTROL_AUTH_DATA: 'synthetic-secret', V2BOARD_CONTROL_ADMIN_PREFIX: 'admin' };
    expect((await refreshRegistryOperationalState(env, { fetcher, now: () => 100_000 })).ok).toBe(true);
    navigation = record('navigation', { items: [...core(), { kind: 'core', targetId: 'unknown', visible: true }] });
    expect((await refreshRegistryOperationalState(env, { fetcher, now: () => 200_000 })).ok).toBe(true);
    const usable = await readRegistryModuleSnapshot(kv.binding(), navigationOperationalDefinition, 200_000, registryOperationalDefinitions);
    expect(usable).toMatchObject({ status: 'available', latestState: RegistryValidationState.INVALID_SCHEMA });
    if (usable.status === 'available') expect(usable.config.items.at(-1)).toMatchObject({ kind: 'custom-page', itemId: 'page-a' });
    expect(await readRegistryModuleSnapshot(kv.binding(), navigationOperationalDefinition, 100_000 + 86_400_001, registryOperationalDefinitions))
      .toMatchObject({ status: 'unavailable', code: 'SNAPSHOT_STALE' });
  });
});
