import { z } from 'zod';
import type { CustomPageMode } from '../../contract/v1/notices';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';
import { isStableId } from '../stable-id';

export const CUSTOM_PAGES_MODULE_ID = 'custom-pages';
export const CUSTOM_PAGES_MAX_STALE_AGE_SECONDS = 86_400;

const UNSAFE_TEXT_PATTERN = /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const UNSAFE_URL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

const plainTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !UNSAFE_TEXT_PATTERN.test(value));

const titleSchema = z
  .object({
    default: plainTitleSchema,
  })
  .strict();

const urlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    if (UNSAFE_URL_PATTERN.test(value)) return false;
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

export const customPagesConfigSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string().refine(isStableId),
          title: titleSchema,
          mode: z.enum(['iframe', 'external']),
          url: urlSchema,
          enabled: z.boolean(),
        })
        .strict()
    ),
  })
  .strict();

export type CustomPagesRegistryConfig = z.infer<typeof customPagesConfigSchema>;

export interface CustomPagesSnapshotConfig {
  items: Array<{
    id: string;
    title: string;
    url: string;
    mode: CustomPageMode;
  }>;
}

export const customPagesSnapshotSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string().refine(isStableId),
          title: plainTitleSchema,
          url: urlSchema,
          mode: z.enum(['iframe', 'external']),
        })
        .strict()
    ),
  })
  .strict();

export const customPagesRegistryDefinition: RegistryModuleDefinition<CustomPagesRegistryConfig> =
  {
    moduleId: CUSTOM_PAGES_MODULE_ID,
    schemaVersion: 1,
    configSchema: customPagesConfigSchema,
    maximumExposure: 'authenticated',
    getItemIds: (config) => config.items.map((item) => item.id),
  };

export const customPagesOperationalDefinition: RegistryOperationalModuleDefinition<
  CustomPagesRegistryConfig,
  CustomPagesSnapshotConfig
> = {
  registryDefinition: customPagesRegistryDefinition,
  freshness: {
    class: 'STALE_TOLERANT',
    maxStaleAgeSeconds: CUSTOM_PAGES_MAX_STALE_AGE_SECONDS,
  },
  snapshotSchema: customPagesSnapshotSchema,
  projectSnapshot: (config) => ({
    items: config.items
      .filter((item) => item.enabled)
      .map((item) => ({
        id: item.id,
        title: item.title.default,
        url: item.url,
        mode: item.mode,
      })),
  }),
};
