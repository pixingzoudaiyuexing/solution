import { describe, expect, it, vi } from 'vitest';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { REGISTRY_CATEGORY, RegistryValidationState, validateRegistryKnowledge } from '../src/registry/kernel';
import {
  PROMOTION_UI_MAX_STALE_AGE_SECONDS,
  promotionUiConfigSchema,
  promotionUiOperationalDefinition,
  promotionUiRegistryDefinition,
} from '../src/registry/modules/promotion-ui';
import { loadRegistryOperationalSnapshot } from '../src/registry/operational';
import { refreshRegistryOperationalState } from '../src/registry/refresh';
import { FakeKV } from './helpers/fake-kv';

const enabledConfig = { showCouponEntry: true, annualPrefillCode: 'ANNUAL2026' };

function body(config: unknown, enabled = true): string {
  return JSON.stringify({ kind: 'aureole.registry', moduleId: 'promotion-ui', schemaVersion: 1, enabled, config });
}

function records(config: string, otherInvalid = false) {
  return [
    { sourceId: 21, category: REGISTRY_CATEGORY, title: 'registry:promotion-ui', show: 1 as const,
      updatedAt: 100, body: config },
    ...(otherInvalid ? [{ sourceId: 22, category: REGISTRY_CATEGORY, title: 'registry:runtime-settings',
      show: 1 as const, updatedAt: 100, body: '{broken' }] : []),
  ];
}

function source(config: string | null): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => {
    const detail = new URL(String(input)).searchParams.has('id');
    return new Response(JSON.stringify({ data: detail
      ? { id: 21, title: 'registry:promotion-ui', category: REGISTRY_CATEGORY, show: 1, updated_at: 100, body: config }
      : config === null ? [] : [{ id: 21, title: 'registry:promotion-ui', category: REGISTRY_CATEGORY, show: 1, updated_at: 100 }],
    }), { headers: { 'Content-Type': 'application/json' } });
  });
}

function env(kv: FakeKV) {
  return { REGISTRY_KV: kv.binding(), V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
    V2BOARD_CONTROL_AUTH_DATA: 'AUTH_SENTINEL', V2BOARD_CONTROL_ADMIN_PREFIX: 'secure-admin' };
}

describe('M11 promotion-ui Registry', () => {
  it('registers a public versioned module with bounded freshness', () => {
    expect(promotionUiRegistryDefinition).toMatchObject({ moduleId: 'promotion-ui', schemaVersion: 1, maximumExposure: 'public' });
    expect(promotionUiOperationalDefinition.freshness).toEqual({ class: 'STALE_TOLERANT', maxStaleAgeSeconds: 86_400 });
    expect(PROMOTION_UI_MAX_STALE_AGE_SECONDS).toBe(86_400);
    expect(registryOperationalDefinitions.at(-1)).toBe(promotionUiOperationalDefinition);
  });

  it('accepts only explicit boolean and optional nullable, safe annual code', () => {
    expect(promotionUiConfigSchema.parse({ showCouponEntry: true })).toEqual({ showCouponEntry: true });
    expect(promotionUiConfigSchema.parse({ showCouponEntry: true, annualPrefillCode: null })).toEqual({ showCouponEntry: true, annualPrefillCode: null });
    expect(promotionUiConfigSchema.parse({ showCouponEntry: true, annualPrefillCode: '  ANNUAL2026  ' })).toEqual(enabledConfig);
    expect(promotionUiConfigSchema.parse({ showCouponEntry: true, annualPrefillCode: 'A'.repeat(255) }).annualPrefillCode).toHaveLength(255);
  });

  it.each([
    ['missing switch', {}], ['string switch', { showCouponEntry: 'true' }],
    ['numeric switch', { showCouponEntry: 1 }], ['invalid code type', { showCouponEntry: true, annualPrefillCode: 42 }],
    ['empty code', { showCouponEntry: true, annualPrefillCode: '' }],
    ['whitespace code', { showCouponEntry: true, annualPrefillCode: '   ' }],
    ['overlong code', { showCouponEntry: true, annualPrefillCode: 'A'.repeat(256) }],
    ['inner space', { showCouponEntry: true, annualPrefillCode: 'A B' }],
    ['line break', { showCouponEntry: true, annualPrefillCode: 'A\nB' }],
    ['nonbreaking space', { showCouponEntry: true, annualPrefillCode: 'A\u00a0B' }],
    ['markup', { showCouponEntry: true, annualPrefillCode: '<script>' }],
    ['script URL', { showCouponEntry: true, scriptUrl: 'https://evil.example/x.js' }],
    ['autoValidate', { showCouponEntry: true, autoValidate: true }],
    ['autoApply', { showCouponEntry: true, autoApply: true }],
    ['autoSelect', { showCouponEntry: true, autoSelect: true }],
    ['couponPriority', { showCouponEntry: true, couponPriority: [] }],
    ['adminCouponToken', { showCouponEntry: true, adminCouponToken: 'secret' }],
  ])('rejects %s', (_label, config) => {
    expect(promotionUiConfigSchema.safeParse(config).success).toBe(false);
  });

  it('projects only public fields and removes hidden code before KV persistence', () => {
    expect(promotionUiOperationalDefinition.projectSnapshot(enabledConfig)).toEqual(enabledConfig);
    expect(promotionUiOperationalDefinition.projectSnapshot({ showCouponEntry: false, annualPrefillCode: 'ANNUAL2026' }))
      .toEqual({ showCouponEntry: false });
    expect(promotionUiOperationalDefinition.projectSnapshot({ showCouponEntry: true })).toEqual({ showCouponEntry: true });
  });

  it('isolates invalid M11 from other modules and invalid other modules from M11', () => {
    const badM11 = validateRegistryKnowledge(records(body({ ...enabledConfig, autoApply: true })),
      registryOperationalDefinitions.map((definition) => definition.registryDefinition));
    expect(badM11.modules.find((module) => module.moduleId === 'promotion-ui')?.state).toBe(RegistryValidationState.INVALID_SCHEMA);
    const otherBad = validateRegistryKnowledge(records(body(enabledConfig), true),
      registryOperationalDefinitions.map((definition) => definition.registryDefinition));
    expect(otherBad.modules.find((module) => module.moduleId === 'promotion-ui')?.state).toBe(RegistryValidationState.VALID_ENABLED);
    expect(otherBad.modules.find((module) => module.moduleId === 'runtime-settings')?.state).toBe(RegistryValidationState.INVALID_SYNTAX);
  });

  it('refreshes the safe snapshot, keeps LKG for invalid input, and clears it for disabled/absent', async () => {
    const kv = new FakeKV();
    const refresh = (input: string | null, at: number) => refreshRegistryOperationalState(env(kv), {
      now: () => at, fetcher: source(input),
    });
    expect((await refresh(body(enabledConfig), 10_000)).ok).toBe(true);
    let state = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    expect(state.status).toBe('valid');
    if (state.status === 'valid') {
      expect(state.snapshot.modules.find((module) => module.moduleId === 'promotion-ui')?.lkg?.config).toEqual(enabledConfig);
      expect(state.snapshot.modules.some((module) => module.moduleId === 'support-widget')).toBe(false);
    }
    await refresh(body({ ...enabledConfig, autoApply: true }), 20_000);
    state = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (state.status === 'valid') expect(state.snapshot.modules.find((module) => module.moduleId === 'promotion-ui'))
      .toMatchObject({ latest: { state: RegistryValidationState.INVALID_SCHEMA }, lkg: { validatedAt: 10_000, config: enabledConfig } });
    await refresh(body(enabledConfig, false), 30_000);
    state = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (state.status === 'valid') expect(state.snapshot.modules.find((module) => module.moduleId === 'promotion-ui'))
      .toEqual({ moduleId: 'promotion-ui', latest: { state: RegistryValidationState.VALID_DISABLED, enabled: false } });
    await refresh(null, 40_000);
    state = await loadRegistryOperationalSnapshot(kv.binding(), registryOperationalDefinitions);
    if (state.status === 'valid') expect(state.snapshot.modules.find((module) => module.moduleId === 'promotion-ui'))
      .toEqual({ moduleId: 'promotion-ui', latest: { state: 'ABSENT' } });
  });
});
