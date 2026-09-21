import { z } from 'zod';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';
import { isStableId } from '../stable-id';

export const ANNOUNCEMENTS_MODULE_ID = 'announcements';
export const ANNOUNCEMENTS_MAX_STALE_AGE_SECONDS = 86_400;

const UNSAFE_PLAIN_TEXT_PATTERN = /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

function plainTextSchema(maxLength: number): z.ZodType<string> {
  return z.string().trim().min(1).max(maxLength).refine(
    (value) => !UNSAFE_PLAIN_TEXT_PATTERN.test(value)
  );
}

const announcementSchema = z.object({
  id: z.string().refine(isStableId),
  title: plainTextSchema(160),
  body: plainTextSchema(4_000),
  enabled: z.boolean(),
  sort: z.number().int().min(0).max(1_000_000),
  visibility: z.enum(['public', 'authenticated']),
}).strict();

export const announcementsConfigSchema = z.object({
  items: z.array(announcementSchema).max(100),
}).strict();

export type AnnouncementsRegistryConfig = z.infer<typeof announcementsConfigSchema>;

export interface AnnouncementsSnapshotConfig {
  items: Array<{
    id: string;
    title: string;
    body: string;
    sort: number;
    visibility: 'public' | 'authenticated';
  }>;
}

export const announcementsSnapshotSchema: z.ZodType<AnnouncementsSnapshotConfig> = z.object({
  items: z.array(z.object({
    id: z.string().refine(isStableId),
    title: plainTextSchema(160),
    body: plainTextSchema(4_000),
    sort: z.number().int().min(0).max(1_000_000),
    visibility: z.enum(['public', 'authenticated']),
  }).strict()).max(100),
}).strict();

export const announcementsRegistryDefinition: RegistryModuleDefinition<AnnouncementsRegistryConfig> = {
  moduleId: ANNOUNCEMENTS_MODULE_ID,
  schemaVersion: 1,
  configSchema: announcementsConfigSchema,
  maximumExposure: 'authenticated',
  getItemIds: (config) => config.items.map((item) => item.id),
};

export const announcementsOperationalDefinition: RegistryOperationalModuleDefinition<
  AnnouncementsRegistryConfig,
  AnnouncementsSnapshotConfig
> = {
  registryDefinition: announcementsRegistryDefinition,
  freshness: {
    class: 'STALE_TOLERANT',
    maxStaleAgeSeconds: ANNOUNCEMENTS_MAX_STALE_AGE_SECONDS,
  },
  snapshotSchema: announcementsSnapshotSchema,
  projectSnapshot: (config) => ({
    items: config.items
      .filter((item) => item.enabled)
      .map(({ id, title, body, sort, visibility }) => ({ id, title, body, sort, visibility }))
      .sort((left, right) => left.sort - right.sort || left.id.localeCompare(right.id)),
  }),
};
