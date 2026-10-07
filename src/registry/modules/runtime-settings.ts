import { z } from 'zod';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';

export const RUNTIME_SETTINGS_MODULE_ID = 'runtime-settings';
export const RUNTIME_SETTINGS_MAX_STALE_AGE_SECONDS = 86_400;

const UNSAFE_PLAIN_TEXT_PATTERN =
  /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

function plainTextSchema(maxLength: number): z.ZodType<string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxLength)
    .refine((value) => !UNSAFE_PLAIN_TEXT_PATTERN.test(value));
}

function httpsUrlSchema(): z.ZodType<string> {
  return z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          url.hostname.length > 0 &&
          url.username.length === 0 &&
          url.password.length === 0
        );
      } catch {
        return false;
      }
    });
}

export const runtimeSettingsConfigSchema = z
  .object({
    siteName: plainTextSchema(120).optional(),
    brandName: plainTextSchema(120).optional(),
    title: plainTextSchema(160).optional(),
    description: plainTextSchema(512).optional(),
    logoUrl: httpsUrlSchema().optional(),
    faviconUrl: httpsUrlSchema().optional(),
    footerText: plainTextSchema(512).optional(),
  })
  .strict();

export type RuntimeSettingsConfig = z.infer<
  typeof runtimeSettingsConfigSchema
>;

export const runtimeSettingsRegistryDefinition: RegistryModuleDefinition<RuntimeSettingsConfig> =
  {
    moduleId: RUNTIME_SETTINGS_MODULE_ID,
    schemaVersion: 1,
    configSchema: runtimeSettingsConfigSchema,
    maximumExposure: 'public',
  };

export const runtimeSettingsOperationalDefinition: RegistryOperationalModuleDefinition<
  RuntimeSettingsConfig,
  RuntimeSettingsConfig
> = {
  registryDefinition: runtimeSettingsRegistryDefinition,
  freshness: {
    class: 'STALE_TOLERANT',
    maxStaleAgeSeconds: RUNTIME_SETTINGS_MAX_STALE_AGE_SECONDS,
  },
  snapshotSchema: runtimeSettingsConfigSchema,
  projectSnapshot: (config) => ({
    ...(config.siteName === undefined ? {} : { siteName: config.siteName }),
    ...(config.brandName === undefined ? {} : { brandName: config.brandName }),
    ...(config.title === undefined ? {} : { title: config.title }),
    ...(config.description === undefined
      ? {}
      : { description: config.description }),
    ...(config.logoUrl === undefined ? {} : { logoUrl: config.logoUrl }),
    ...(config.faviconUrl === undefined
      ? {}
      : { faviconUrl: config.faviconUrl }),
    ...(config.footerText === undefined
      ? {}
      : { footerText: config.footerText }),
  }),
};
