import { z } from 'zod';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';

export const SUPPORT_WIDGET_MODULE_ID = 'support-widget';
export const SUPPORT_WIDGET_MAX_STALE_AGE_SECONDS = 86_400;

const crispWebsiteIdSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
);

const crispSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), websiteId: crispWebsiteIdSchema }).strict(),
]);

export const supportWidgetConfigSchema = z.object({
  crisp: crispSchema,
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
  }),
};
