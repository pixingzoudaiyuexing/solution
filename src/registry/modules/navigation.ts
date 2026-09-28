import { z } from 'zod';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';
import { isStableId } from '../stable-id';

export const NAVIGATION_MODULE_ID = 'navigation';
export const NAVIGATION_MAX_STALE_AGE_SECONDS = 86_400;
export const NAVIGATION_MAX_ITEMS = 64;

export const NAVIGATION_CORE_TARGETS = [
  'dashboard', 'subscription', 'plans', 'resources', 'apple-id', 'orders',
  'wallet', 'notices', 'help-center', 'support', 'referrals', 'download-center',
] as const;
export type NavigationCoreTargetId = (typeof NAVIGATION_CORE_TARGETS)[number];

export const NAVIGATION_DEFAULT_LABELS: Record<NavigationCoreTargetId, string> = {
  dashboard: 'Overview', subscription: 'Subscription', plans: 'Plans', resources: 'Resources',
  'apple-id': 'Apple ID', orders: 'Orders', wallet: 'Wallet', notices: 'Notices',
  'help-center': '帮助中心', support: 'Support', referrals: 'Referrals', 'download-center': 'Download Center',
};

const unsafeLabel = /[<>\u0000-\u001f\u007f-\u009f]/;
const labelSchema = z.object({
  default: z.string().trim().min(1).max(120).refine((value) => !unsafeLabel.test(value)),
}).strict();
const coreTargetSchema = z.enum(NAVIGATION_CORE_TARGETS);
const coreItemSchema = z.object({
  kind: z.literal('core'),
  targetId: coreTargetSchema,
  visible: z.boolean(),
  label: labelSchema.optional(),
}).strict();
const customPageItemSchema = z.object({
  kind: z.literal('custom-page'),
  target: z.object({ moduleId: z.literal('custom-pages'), itemId: z.string().refine(isStableId) }).strict(),
  visible: z.boolean(),
  label: labelSchema.optional(),
}).strict();

export const navigationConfigSchema = z.object({
  items: z.array(z.discriminatedUnion('kind', [coreItemSchema, customPageItemSchema])).min(12).max(NAVIGATION_MAX_ITEMS),
}).strict().superRefine((config, ctx) => {
  const core = config.items.filter((item): item is z.infer<typeof coreItemSchema> => item.kind === 'core');
  const counts = new Map<string, number>();
  for (const item of core) counts.set(item.targetId, (counts.get(item.targetId) ?? 0) + 1);
  for (const target of NAVIGATION_CORE_TARGETS) {
    const count = counts.get(target) ?? 0;
    if (count !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: `Core target ${target} must occur exactly once` });
  }
  if (!core.some((item) => item.targetId === 'dashboard' && item.visible)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Dashboard must be visible' });
  }
  const refs = config.items.filter((item): item is z.infer<typeof customPageItemSchema> => item.kind === 'custom-page')
    .map((item) => item.target.itemId);
  if (new Set(refs).size !== refs.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Custom page references must be unique' });
});

export type NavigationRegistryConfig = z.infer<typeof navigationConfigSchema>;

export type NavigationSnapshotConfig = {
  items: Array<
    | { kind: 'core'; targetId: NavigationCoreTargetId; visible: boolean; label?: string }
    | { kind: 'custom-page'; itemId: string; visible: boolean; label?: string }
  >;
};

const snapshotItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('core'), targetId: coreTargetSchema, visible: z.boolean(), label: z.string().trim().min(1).max(120).refine((value) => !unsafeLabel.test(value)).optional() }).strict(),
  z.object({ kind: z.literal('custom-page'), itemId: z.string().refine(isStableId), visible: z.boolean(), label: z.string().trim().min(1).max(120).refine((value) => !unsafeLabel.test(value)).optional() }).strict(),
]);

export const navigationSnapshotSchema = z.object({
  items: z.array(snapshotItemSchema).min(12).max(NAVIGATION_MAX_ITEMS),
}).strict().superRefine((config, ctx) => {
  const core = config.items.filter((item) => item.kind === 'core');
  for (const target of NAVIGATION_CORE_TARGETS) {
    if (core.filter((item) => item.targetId === target).length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Incomplete core target catalog' });
      return;
    }
  }
  if (!core.some((item) => item.targetId === 'dashboard' && item.visible) ||
      new Set(config.items.filter((item) => item.kind === 'custom-page').map((item) => item.itemId)).size !==
      config.items.filter((item) => item.kind === 'custom-page').length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Invalid navigation identity' });
  }
});

export const navigationRegistryDefinition: RegistryModuleDefinition<NavigationRegistryConfig> = {
  moduleId: NAVIGATION_MODULE_ID,
  schemaVersion: 1,
  configSchema: navigationConfigSchema,
  maximumExposure: 'authenticated',
  getReferences: (config) => config.items.flatMap((item) => item.kind === 'custom-page'
    ? [{ moduleId: item.target.moduleId, itemId: item.target.itemId }]
    : []),
};

export const navigationOperationalDefinition: RegistryOperationalModuleDefinition<NavigationRegistryConfig, NavigationSnapshotConfig> = {
  registryDefinition: navigationRegistryDefinition,
  freshness: { class: 'STALE_TOLERANT', maxStaleAgeSeconds: NAVIGATION_MAX_STALE_AGE_SECONDS },
  snapshotSchema: navigationSnapshotSchema,
  projectSnapshot: (config) => ({
    items: config.items.map((item) => item.kind === 'core'
      ? { kind: item.kind, targetId: item.targetId, visible: item.visible, ...(item.label ? { label: item.label.default } : {}) }
      : { kind: item.kind, itemId: item.target.itemId, visible: item.visible, ...(item.label ? { label: item.label.default } : {}) }),
  }),
};
