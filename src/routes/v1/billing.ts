import { Hono } from 'hono';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardPaymentAdapter } from '../../adapters/v2board/payment';
import type { PaymentMethodsSuccessResponse } from '../../contract/v1/payment';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const billingRouter = new Hono<GatewayContext>();

billingRouter.get('/methods', requireAuthorization, async (c) => {
  if (!c.env.V2BOARD_BASE_URL) {
    throw new Error('V2Board is not configured');
  }
  const adapter = new V2BoardPaymentAdapter(
    createV2BoardClient(c.env),
    c.env.V2BOARD_BASE_URL
  );
  const methods = await adapter.paymentMethods(c.get('authToken'));
  const response: PaymentMethodsSuccessResponse = {
    ok: true,
    data: methods,
    requestId: requestId(c),
  };

  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { billingRouter };
