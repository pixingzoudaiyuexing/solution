import { Hono } from 'hono';
import { z } from 'zod';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardGiftCardsAdapter } from '../../adapters/v2board/gift-cards';
import { GatewayError } from '../../contract/error';
import type { RedeemGiftCardSuccessResponse } from '../../contract/v1/gift-cards';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const giftCardsRouter = new Hono<GatewayContext>();
const redeemSchema = z.object({ code: z.string().min(1).max(255) }).strict();

giftCardsRouter.post('/redeem', requireAuthorization, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const parsed = redeemSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }

  const adapter = new V2BoardGiftCardsAdapter(createV2BoardClient(c.env));
  const data = await adapter.redeem(c.get('authToken'), parsed.data.code);
  const response: RedeemGiftCardSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { giftCardsRouter };
