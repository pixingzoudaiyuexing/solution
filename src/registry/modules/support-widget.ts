import { z } from 'zod';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';

export const SUPPORT_WIDGET_MODULE_ID = 'support-widget';
export const SUPPORT_WIDGET_MAX_STALE_AGE_SECONDS = 86_400;

const crispWebsiteIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
);
const chatwootWebsiteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);

const chatwootOriginSchema = z.string().min(1).max(2048).transform((value, ctx) => {
  try {
    if (value.trim() !== value || /[\\\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || url.port ||
        !/^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) ||
        url.hostname.split('.').some((label) => label.startsWith('-') || label.endsWith('-')) ||
        url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') ||
        url.hostname.endsWith('.internal') || url.hostname.endsWith('.test') ||
        url.hostname.endsWith('.invalid') || /^\d+(?:\.\d+){3}$/.test(url.hostname)) throw new Error();
    return url.origin;
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Chatwoot HTTPS origin' });
    return z.NEVER;
  }
});

const crispSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), websiteId: crispWebsiteIdSchema }).strict(),
]);
const chatwootSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), baseUrl: chatwootOriginSchema, websiteToken: chatwootWebsiteTokenSchema }).strict(),
]);

export const supportWidgetConfigSchema = z.object({
  crisp: crispSchema,
  chatwoot: chatwootSchema,
}).strict();

export type SupportWidgetConfig = z.infer<typeof supportWidgetConfigSchema>;

export const supportWidgetRegistryDefinition: RegistryModuleDefinition<SupportWidgetConfig> = {
  moduleId: SUPPORT_WIDGET_MODULE_ID,
  schemaVersion: 1,
  configSchema: supportWidgetConfigSchema,
  maximumExposure: 'public',
};

export const supportWidgetOperationalDefinition: RegistryOperationalModuleDefinition<
  SupportWidgetConfig,
  SupportWidgetConfig
> = {
  registryDefinition: supportWidgetRegistryDefinition,
  freshness: { class: 'STALE_TOLERANT', maxStaleAgeSeconds: SUPPORT_WIDGET_MAX_STALE_AGE_SECONDS },
  snapshotSchema: supportWidgetConfigSchema,
  projectSnapshot: (config) => ({
    crisp: config.crisp.enabled
      ? { enabled: true, websiteId: config.crisp.websiteId }
      : { enabled: false },
    chatwoot: config.chatwoot.enabled
      ? { enabled: true, baseUrl: config.chatwoot.baseUrl, websiteToken: config.chatwoot.websiteToken }
      : { enabled: false },
  }),
};
