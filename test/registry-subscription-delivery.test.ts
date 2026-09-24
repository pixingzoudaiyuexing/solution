import { describe, expect, it } from 'vitest';
import {
  SUBSCRIPTION_DELIVERY_MAX_STALE_AGE_SECONDS,
  subscriptionDeliveryConfigSchema,
  subscriptionDeliveryOperationalDefinition,
  subscriptionDeliveryRegistryDefinition,
  isSubscriptionDeliverySafeForDeployment,
} from '../src/registry/modules/subscription-delivery';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { REGISTRY_CATEGORY, RegistryValidationState, validateRegistryKnowledge } from '../src/registry/kernel';

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'primary', label: { default: 'Subscription' }, enabled: true, selectable: true,
  publicOrigin: 'https://sub.example.com', pathPrefix: '', ...overrides,
});

describe('REG-M04 subscription delivery definition', () => {
  it('is authenticated and code-owned stale tolerant', () => {
    expect(subscriptionDeliveryRegistryDefinition).toMatchObject({
      moduleId: 'subscription-delivery',
      schemaVersion: 1,
      maximumExposure: 'authenticated',
    });
    expect(subscriptionDeliveryOperationalDefinition.freshness).toEqual({
      class: 'STALE_TOLERANT',
      maxStaleAgeSeconds: 86_400,
    });
    expect(SUBSCRIPTION_DELIVERY_MAX_STALE_AGE_SECONDS).toBe(86_400);
    expect(registryOperationalDefinitions.map((item) => item.registryDefinition.moduleId)).toEqual([
      'runtime-settings', 'custom-pages', 'subscription-delivery', 'announcements', 'promotion-ui',
    ]);
  });

  it('accepts canonical public delivery config', () => {
    expect(subscriptionDeliveryConfigSchema.parse({
      defaultEntryId: 'primary',
      entries: [{ id: 'primary', label: { default: ' Subscription ' }, enabled: true, selectable: true, publicOrigin: 'https://sub.example.com/', pathPrefix: '' }],
    })).toEqual({
      defaultEntryId: 'primary',
      entries: [{ id: 'primary', label: { default: 'Subscription' }, enabled: true, selectable: true, publicOrigin: 'https://sub.example.com', pathPrefix: '' }],
    });
    expect(subscriptionDeliveryConfigSchema.safeParse({ defaultEntryId: null, entries: [] }).success).toBe(true);
  });

  it.each([
    ['missing default', { defaultEntryId: null, entries: [{ id: 'primary', label: { default: 'X' }, enabled: true, selectable: true, publicOrigin: 'https://sub.example.com', pathPrefix: '' }] }],
    ['bad default', { defaultEntryId: 'other', entries: [{ id: 'primary', label: { default: 'X' }, enabled: true, selectable: true, publicOrigin: 'https://sub.example.com', pathPrefix: '' }] }],
    ['default with none selectable', { defaultEntryId: 'primary', entries: [{ id: 'primary', label: { default: 'X' }, enabled: true, selectable: false, publicOrigin: 'https://sub.example.com', pathPrefix: '' }] }],
    ['localhost', { defaultEntryId: 'primary', entries: [{ id: 'primary', label: { default: 'X' }, enabled: true, selectable: true, publicOrigin: 'https://localhost', pathPrefix: '' }] }],
    ['private ip', { defaultEntryId: 'primary', entries: [{ id: 'primary', label: { default: 'X' }, enabled: true, selectable: true, publicOrigin: 'https://192.168.1.1', pathPrefix: '' }] }],
    ['path origin', { defaultEntryId: 'primary', entries: [{ id: 'primary', label: { default: 'X' }, enabled: true, selectable: true, publicOrigin: 'https://sub.example.com/x', pathPrefix: '' }] }],
    ['reserved prefix', { defaultEntryId: 'primary', entries: [{ id: 'primary', label: { default: 'X' }, enabled: true, selectable: true, publicOrigin: 'https://sub.example.com', pathPrefix: 'api' }] }],
    ['markup label', { defaultEntryId: 'primary', entries: [{ id: 'primary', label: { default: '<x>' }, enabled: true, selectable: true, publicOrigin: 'https://sub.example.com', pathPrefix: '' }] }],
  ])('rejects %s', (_case, value) => {
    expect(subscriptionDeliveryConfigSchema.safeParse(value).success).toBe(false);
  });

  it('accepts 100 entries and rejects 101', () => {
    const entries100 = Array.from({ length: 100 }, (_, index) => entry({ id: `entry-${index}` }));
    expect(subscriptionDeliveryConfigSchema.safeParse({ defaultEntryId: 'entry-0', entries: entries100 }).success).toBe(true);
    expect(subscriptionDeliveryConfigSchema.safeParse({ defaultEntryId: 'entry-0', entries: [...entries100, entry({ id: 'entry-100' })] }).success).toBe(false);
  });

  it('rejects duplicate IDs through A1 Registry validation', () => {
    const body = JSON.stringify({ kind: 'aureole.registry', moduleId: 'subscription-delivery', schemaVersion: 1, enabled: true, config: { defaultEntryId: 'primary', entries: [entry(), entry()] } });
    const report = validateRegistryKnowledge([{ sourceId: 1, category: REGISTRY_CATEGORY, title: 'registry:subscription-delivery', show: 1, updatedAt: 1, body }], [subscriptionDeliveryRegistryDefinition]);
    expect(report.modules[0]).toMatchObject({ state: RegistryValidationState.INVALID_SCHEMA, code: 'DUPLICATE_ITEM_ID' });
  });

  it.each([
    ['config unknown', { defaultEntryId: null, entries: [], extra: true }],
    ['entry unknown', { defaultEntryId: 'primary', entries: [entry({ extra: true })] }],
    ['label unknown', { defaultEntryId: 'primary', entries: [entry({ label: { default: 'X', extra: true } })] }],
    ['invalid id', { defaultEntryId: 'Bad_ID', entries: [entry({ id: 'Bad_ID' })] }],
    ['empty label', { defaultEntryId: 'primary', entries: [entry({ label: { default: ' ' } })] }],
    ['long label', { defaultEntryId: 'primary', entries: [entry({ label: { default: 'x'.repeat(121) } })] }],
    ['control label', { defaultEntryId: 'primary', entries: [entry({ label: { default: 'bad\u0000x' } })] }],
    ['http', { defaultEntryId: 'primary', entries: [entry({ publicOrigin: 'http://sub.example.com' })] }],
    ['userinfo', { defaultEntryId: 'primary', entries: [entry({ publicOrigin: 'https://u:p@sub.example.com' })] }],
    ['query', { defaultEntryId: 'primary', entries: [entry({ publicOrigin: 'https://sub.example.com?x=1' })] }],
    ['fragment', { defaultEntryId: 'primary', entries: [entry({ publicOrigin: 'https://sub.example.com/#x' })] }],
    ['local suffix', { defaultEntryId: 'primary', entries: [entry({ publicOrigin: 'https://host.local' })] }],
    ['unsafe prefix', { defaultEntryId: 'primary', entries: [entry({ pathPrefix: 'cdn-cgi' })] }],
    ['uppercase prefix', { defaultEntryId: 'primary', entries: [entry({ pathPrefix: 'Upper' })] }],
    ['long prefix', { defaultEntryId: 'primary', entries: [entry({ pathPrefix: `a${'b'.repeat(64)}` })] }],
  ])('rejects %s', (_case, value) => expect(subscriptionDeliveryConfigSchema.safeParse(value).success).toBe(false));

  it.each([
    'https://[::1]', 'https://[::]', 'https://[fc00::1]', 'https://[fd00::1]',
    'https://[fe80::1]', 'https://[ff02::1]', 'https://[2001:db8::1]',
    'https://[::ffff:127.0.0.1]', 'https://[::ffff:10.0.0.1]', 'https://[::ffff:192.168.1.1]',
  ])('rejects unsafe IPv6 origin %s', (publicOrigin) => {
    expect(subscriptionDeliveryConfigSchema.safeParse({ defaultEntryId: 'primary', entries: [entry({ publicOrigin })] }).success).toBe(false);
  });

  it('accepts a globally routable IPv6 literal', () => {
    expect(subscriptionDeliveryConfigSchema.safeParse({ defaultEntryId: 'primary', entries: [entry({ publicOrigin: 'https://[2606:4700:4700::1111]' })] }).success).toBe(true);
  });

  it.each(['https://hidden.example', 'https://hidden.example/', 'https://hidden.example.', 'https://HIDDEN.EXAMPLE'])('normalizes hidden host conflict %s', (publicOrigin) => {
    const parsed = subscriptionDeliveryConfigSchema.parse({ defaultEntryId: 'primary', entries: [entry({ publicOrigin })] });
    expect(isSubscriptionDeliverySafeForDeployment(parsed, 'https://hidden.example/api/v1/')).toBe(false);
  });

  it('accepts a distinct deployment hostname', () => {
    const parsed = subscriptionDeliveryConfigSchema.parse({ defaultEntryId: 'primary', entries: [entry()] });
    expect(isSubscriptionDeliverySafeForDeployment(parsed, 'https://hidden.example/api/v1/')).toBe(true);
  });
});
