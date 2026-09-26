import { z } from 'zod';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';

export const SUBSCRIPTION_PROFILE_MODULE_ID = 'subscription-profile';
export const CC_APPLICATION_IDS = [
  'youtube', 'google', 'ai', 'netflix', 'disney', 'tiktok', 'bilibili',
] as const;

const labelSchema = z.object({
  default: z.string().trim().min(1).max(120).refine((value) => !/[<>\u0000-\u001f\u007f-\u009f]/.test(value)),
}).strict();

const groupSchema = z.object({
  id: z.enum(CC_APPLICATION_IDS),
  enabled: z.boolean(),
  label: labelSchema.refine((label) => !label.default.includes(',') &&
    !['DIRECT', 'REJECT', 'GLOBAL', 'PASS', '自动选择', '故障转移'].includes(label.default)),
  defaultPolicy: z.enum(['auto', 'direct']),
}).strict();

export const subscriptionProfileConfigSchema = z.object({
  profileId: z.literal('cc'),
  enabled: z.boolean(),
  label: labelSchema,
  groups: z.array(groupSchema).length(CC_APPLICATION_IDS.length),
}).strict().superRefine((config, ctx) => {
  if (new Set(config.groups.map((group) => group.id)).size !== CC_APPLICATION_IDS.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groups'], message: 'Invalid logical group set' });
  }
  if (new Set(config.groups.map((group) => group.label.default)).size !== CC_APPLICATION_IDS.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groups'], message: 'Duplicate group label' });
  }
});

export type SubscriptionProfileConfig = z.infer<typeof subscriptionProfileConfigSchema>;

export const subscriptionProfileRegistryDefinition: RegistryModuleDefinition<SubscriptionProfileConfig> = {
  moduleId: SUBSCRIPTION_PROFILE_MODULE_ID,
  schemaVersion: 1,
  configSchema: subscriptionProfileConfigSchema,
  maximumExposure: 'authenticated',
  getItemIds: (config) => config.groups.map((group) => group.id),
};

export const subscriptionProfileOperationalDefinition: RegistryOperationalModuleDefinition<SubscriptionProfileConfig, SubscriptionProfileConfig> = {
  registryDefinition: subscriptionProfileRegistryDefinition,
  freshness: { class: 'STALE_TOLERANT', maxStaleAgeSeconds: 86_400 },
  snapshotSchema: subscriptionProfileConfigSchema,
  projectSnapshot: (config) => ({
    profileId: config.profileId,
    enabled: config.enabled,
    label: { default: config.label.default },
    groups: config.groups.map((group) => ({
      id: group.id,
      enabled: group.enabled,
      label: { default: group.label.default },
      defaultPolicy: group.defaultPolicy,
    })),
  }),
};
