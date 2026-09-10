import { Hono } from 'hono';
import { z } from 'zod';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardOrdersAdapter } from '../../adapters/v2board/orders';
import { V2BoardPaymentAdapter } from '../../adapters/v2board/payment';
import {
  ORDER_BILLING_PERIODS,
  ORDER_ID_PATTERN,
  type CreateOrderSuccessResponse,
  type OrderSuccessResponse,
  type OrdersSuccessResponse,
} from '../../contract/v1/orders';
import { GatewayError } from '../../contract/error';
import {
  PAYMENT_METHOD_ID_PATTERN,
  type CheckoutSuccessResponse,
} from '../../contract/v1/payment';
import type { Env } from '../../config/env';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';
import { isAllowedFrontendOrigin } from '../../security/cors';

const ordersRouter = new Hono<GatewayContext>();
const productIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .refine((value) => Number(value) <= 2_147_483_647);
const createOrderSchema = z
  .object({
    productId: productIdSchema,
    billingPeriod: z.enum(ORDER_BILLING_PERIODS),
  })
  .strict();
const orderIdSchema = z.string().regex(ORDER_ID_PATTERN);
const checkoutSchema = z
  .object({
    paymentMethodId: z
      .string()
      .regex(PAYMENT_METHOD_ID_PATTERN)
      .refine((value) => Number(value) <= 2_147_483_647),
  })
  .strict();

function orderAdapter(env: Env): V2BoardOrdersAdapter {
  return new V2BoardOrdersAdapter(createV2BoardClient(env));
}

ordersRouter.get('/', requireAuthorization, async (c) => {
  const orders = await orderAdapter(c.env).orders(c.get('authToken'));
  const response: OrdersSuccessResponse = {
    ok: true,
    data: orders,
    requestId: requestId(c),
  };

  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

ordersRouter.post('/', requireAuthorization, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }

  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }

  const order = await orderAdapter(c.env).createOrder(
    c.get('authToken'),
    parsed.data
  );
  const response: CreateOrderSuccessResponse = {
    ok: true,
    data: order,
    requestId: requestId(c),
  };

  c.header('Cache-Control', 'no-store');
  return c.json(response, 201);
});

ordersRouter.get('/:id', requireAuthorization, async (c) => {
  const parsedId = orderIdSchema.safeParse(c.req.param('id'));
  if (!parsedId.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }

  const order = await orderAdapter(c.env).order(
    c.get('authToken'),
    parsedId.data
  );
  const response: OrderSuccessResponse = {
    ok: true,
    data: order,
    requestId: requestId(c),
  };

  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

ordersRouter.post('/:id/checkout', requireAuthorization, async (c) => {
  const parsedId = orderIdSchema.safeParse(c.req.param('id'));
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const parsedBody = checkoutSchema.safeParse(body);
  if (!parsedId.success || !parsedBody.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  if (!c.env.V2BOARD_BASE_URL) {
    throw new Error('V2Board is not configured');
  }

  const requestOrigin = c.req.header('Origin');
  const trustedOrigin = isAllowedFrontendOrigin(
    requestOrigin,
    c.env.FRONTEND_ORIGINS
  ) && requestOrigin.startsWith('https://')
    ? requestOrigin
    : undefined;
  const adapter = new V2BoardPaymentAdapter(
    createV2BoardClient(c.env),
    c.env.V2BOARD_BASE_URL
  );
  const action = await adapter.checkout(
    c.get('authToken'),
    parsedId.data,
    parsedBody.data,
    trustedOrigin
  );
  const response: CheckoutSuccessResponse = {
    ok: true,
    data: action,
    requestId: requestId(c),
  };

  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { ordersRouter };
