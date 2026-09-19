import { z } from 'zod';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';
import { isStableId } from '../stable-id';

export const SUBSCRIPTION_DELIVERY_MODULE_ID = 'subscription-delivery';
export const SUBSCRIPTION_DELIVERY_MAX_STALE_AGE_SECONDS = 86_400;
export const RESERVED_SUBSCRIPTION_PREFIXES = new Set(['api', 'cdn-cgi']);

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const LABEL_BAD = /[<>\u0000-\u001f\u007f-\u009f]/;

function unsafeHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const v4 = host.split('.');
  if (v4.length === 4 && v4.every((part) => /^\d+$/.test(part))) {
    const [a, b, c, d] = v4.map(Number);
    if ([a, b, c, d].some((n) => n < 0 || n > 255)) return true;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  if (host.includes(':')) {
    return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') ||
      /^fe[89ab]/.test(host) || host.startsWith('ff') || host.startsWith('2001:db8:');
  }
  return false;
}

const publicOriginSchema = z.string().trim().min(1).max(2048).transform((value, ctx) => {
  try {
    if (CONTROL.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || unsafeHost(url.hostname)) throw new Error();
    return url.origin;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid public origin' });
    return z.NEVER;
  }
});

export function validateSubscriptionPathPrefix(value: string): string {
  if (value === '') return value;
  if (!isStableId(value) || RESERVED_SUBSCRIPTION_PREFIXES.has(value)) {
    throw new Error('Invalid subscription path prefix');
  }
  return value;
}

const entrySchema = z.object({
  id: z.string().refine(isStableId),
  label: z.object({ default: z.string().trim().min(1).max(120).refine((v) => !LABEL_BAD.test(v)) }).strict(),
  enabled: z.boolean(),
  selectable: z.boolean(),
  publicOrigin: publicOriginSchema,
  pathPrefix: z.string().max(64).transform((value, ctx) => {
    try { return validateSubscriptionPathPrefix(value); }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid prefix' }); return z.NEVER; }
  }),
}).strict();

export const subscriptionDeliveryConfigSchema = z.object({
  defaultEntryId: z.string().refine(isStableId).nullable(),
  entries: z.array(entrySchema).max(100),
}).strict().superRefine((config, ctx) => {
  const selectable = config.entries.filter((entry) => entry.enabled && entry.selectable);
  const validDefault = config.defaultEntryId !== null && selectable.some((entry) => entry.id === config.defaultEntryId);
  if ((selectable.length === 0 && config.defaultEntryId !== null) ||
      (selectable.length > 0 && !validDefault)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultEntryId'], message: 'Invalid default' });
  }
});

export type SubscriptionDeliveryConfig = z.infer<typeof subscriptionDeliveryConfigSchema>;
export type SubscriptionDeliverySnapshot = SubscriptionDeliveryConfig;

export const subscriptionDeliveryRegistryDefinition: RegistryModuleDefinition<SubscriptionDeliveryConfig> = {
  moduleId: SUBSCRIPTION_DELIVERY_MODULE_ID,
  schemaVersion: 1,
  configSchema: subscriptionDeliveryConfigSchema,
  maximumExposure: 'authenticated',
  getItemIds: (config) => config.entries.map((entry) => entry.id),
};

export const subscriptionDeliveryOperationalDefinition: RegistryOperationalModuleDefinition<SubscriptionDeliveryConfig, SubscriptionDeliverySnapshot> = {
  registryDefinition: subscriptionDeliveryRegistryDefinition,
  freshness: { class: 'STALE_TOLERANT', maxStaleAgeSeconds: SUBSCRIPTION_DELIVERY_MAX_STALE_AGE_SECONDS },
  snapshotSchema: subscriptionDeliveryConfigSchema,
  projectSnapshot: (config) => ({
    defaultEntryId: config.defaultEntryId,
    entries: config.entries.map((entry) => ({
      id: entry.id,
      label: { default: entry.label.default },
      enabled: entry.enabled,
      selectable: entry.selectable,
      publicOrigin: entry.publicOrigin,
      pathPrefix: entry.pathPrefix,
    })),
  }),
};

export function isSubscriptionDeliverySafeForDeployment(
  config: SubscriptionDeliverySnapshot,
  hiddenBaseUrl: string
): boolean {
  try {
    const hidden = new URL(hiddenBaseUrl);
    return config.entries.every((entry) => new URL(entry.publicOrigin).hostname.toLowerCase() !== hidden.hostname.toLowerCase());
  } catch { return false; }
}
