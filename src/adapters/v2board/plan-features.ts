import { z } from 'zod';
import type { ProductFeature } from '../../contract/product';

// String limits are UTF-16 code units, matching JavaScript/Zod string length.
export const PLAN_FEATURES_MAX_CONTENT_LENGTH = 16_384;
export const PLAN_FEATURES_MAX_ITEMS = 32;
export const PLAN_FEATURES_MAX_TEXT_LENGTH = 256;

const featuresSchema = z.array(z.object({
  feature: z.string().min(1).max(PLAN_FEATURES_MAX_TEXT_LENGTH)
    .refine((value) => value.trim().length > 0),
  support: z.boolean(),
}).strict()).min(1).max(PLAN_FEATURES_MAX_ITEMS);

/** Parse presentation-only JSON; an invalid description never rejects the plan. */
export function parsePlanFeatures(content: unknown): ProductFeature[] | undefined {
  if (typeof content !== 'string' || content.length > PLAN_FEATURES_MAX_CONTENT_LENGTH || !content.trim()) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(content);
    // Bound validation work before entering the item schema. No coercion or partial arrays.
    if (!Array.isArray(value) || value.length === 0 || value.length > PLAN_FEATURES_MAX_ITEMS) return undefined;
    const parsed = featuresSchema.safeParse(value);
    if (!parsed.success) return undefined;
    return parsed.data.map(({ feature, support }) => ({ feature, support }));
  } catch {
    // No raw content, parsing error, credential or metadata is exposed as a fallback.
    return undefined;
  }
}
