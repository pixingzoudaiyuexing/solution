import { z } from 'zod';
import type { RegistryModuleDefinition } from '../kernel';
import type { RegistryOperationalModuleDefinition } from '../operational';

export const PROMOTION_UI_MODULE_ID = 'promotion-ui';
export const PROMOTION_UI_MAX_STALE_AGE_SECONDS = 86_400;

const annualPrefillCodeSchema = z.string().trim().min(1).max(255).refine(
  (code) => !/[\s<>\u0000-\u001f\u007f-\u009f]/u.test(code)
);

export const promotionUiConfigSchema = z.object({
  showCouponEntry: z.boolean(),
  annualPrefillCode: annualPrefillCodeSchema.nullable().optional(),
}).strict();

export type PromotionUiRegistryConfig = z.infer<typeof promotionUiConfigSchema>;

export const promotionUiRegistryDefinition: RegistryModuleDefinition<PromotionUiRegistryConfig> = {
  moduleId: PROMOTION_UI_MODULE_ID,
  schemaVersion: 1,
  configSchema: promotionUiConfigSchema,
  maximumExposure: 'public',
};

export const promotionUiOperationalDefinition: RegistryOperationalModuleDefinition<
  PromotionUiRegistryConfig,
  PromotionUiRegistryConfig
> = {
  registryDefinition: promotionUiRegistryDefinition,
  freshness: { class: 'STALE_TOLERANT', maxStaleAgeSeconds: PROMOTION_UI_MAX_STALE_AGE_SECONDS },
  snapshotSchema: promotionUiConfigSchema,
  projectSnapshot: (config) => ({
    showCouponEntry: config.showCouponEntry,
    ...(config.showCouponEntry && config.annualPrefillCode
      ? { annualPrefillCode: config.annualPrefillCode }
      : {}),
  }),
};
