import { Hono } from 'hono';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardOrdersAdapter } from '../../adapters/v2board/orders';
import type { OrdersSuccessResponse } from '../../contract/v1/orders';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const ordersRouter = new Hono<GatewayContext>();

ordersRouter.get('/', requireAuthorization, async (c) => {
  const adapter = new V2BoardOrdersAdapter(createV2BoardClient(c.env));
  const orders = await adapter.orders(c.get('authToken'));
  const response: OrdersSuccessResponse = {
    ok: true,
    data: orders,
    requestId: requestId(c),
  };

  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { ordersRouter };
