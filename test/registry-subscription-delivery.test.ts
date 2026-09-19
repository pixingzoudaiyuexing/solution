import { describe, expect, it } from 'vitest';
import {
  SUBSCRIPTION_DELIVERY_MAX_STALE_AGE_SECONDS,
  subscriptionDeliveryConfigSchema,
  subscriptionDeliveryOperationalDefinition,
  subscriptionDeliveryRegistryDefinition,
} from '../src/registry/modules/subscription-delivery';

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
});
