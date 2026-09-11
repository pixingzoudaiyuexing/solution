import { Hono } from 'hono';
import { z } from 'zod';
import { V2BoardPromotionsAdapter } from '../../adapters/v2board/promotions';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import type { ValidatePromotionSuccessResponse } from '../../contract/v1/promotions';
import { GatewayError } from '../../contract/error';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const promotionsRouter = new Hono<GatewayContext>();
const validatePromotionSchema = z
  .object({
    code: z.string().trim().min(1).max(255),
    productId: z.number().int().positive().max(2_147_483_647),
  })
  .strict();

promotionsRouter.post('/validate', requireAuthorization, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const parsed = validatePromotionSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const adapter = new V2BoardPromotionsAdapter(createV2BoardClient(c.env));
  const data = await adapter.validatePromotion(c.get('authToken'), parsed.data);
  const response: ValidatePromotionSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { promotionsRouter };
