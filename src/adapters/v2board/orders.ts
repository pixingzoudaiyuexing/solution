import { z } from 'zod';
import { ORDER_ID_PATTERN } from '../../contract/v1/orders';
import type {
  CreatedOrder,
  CreateOrderRequest,
  Order,
  OrderBillingPeriod,
  OrderStatus,
} from '../../contract/v1/orders';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardOrderCreateError,
  V2BoardOrderNotFoundError,
  V2BoardOrderQueryError,
  V2BoardUpstreamError,
} from './errors';

const timestampSchema = z
  .number()
  .int()
  .nonnegative()
  .max(253402300799);
const orderStatusSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
const orderSchema = z
  .object({
    trade_no: z.string().regex(ORDER_ID_PATTERN),
    status: orderStatusSchema,
    total_amount: z.number().int().nonnegative().max(2_147_483_647),
    created_at: timestampSchema,
    updated_at: timestampSchema.nullable(),
    expires_at: timestampSchema.nullable().optional(),
  })
  .strip();
const ordersResponseSchema = z
  .object({ data: z.array(orderSchema) })
  .strip();
const orderResponseSchema = z.object({ data: orderSchema }).strip();
const createdOrderResponseSchema = z
  .object({ data: z.string().regex(ORDER_ID_PATTERN) })
  .strip();
const orderErrorSchema = z
  .object({
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .strip();

const STATUS_MAP: Record<z.infer<typeof orderStatusSchema>, OrderStatus> = {
  0: 'pending',
  1: 'processing',
  2: 'cancelled',
  3: 'completed',
  4: 'adjusted',
};

const PERIOD_MAP: Record<OrderBillingPeriod, string> = {
  month: 'month_price',
  quarter: 'quarter_price',
  halfYear: 'half_year_price',
  year: 'year_price',
  twoYears: 'two_year_price',
  threeYears: 'three_year_price',
  oneTime: 'onetime_price',
};

const ORDER_NOT_FOUND_MESSAGES = new Set([
  'order does not exist',
  'order does not exist or has been paid',
  '订单不存在',
  '订单不存在或已支付',
]);

function toIsoTimestamp(value: number): string {
  return new Date(value * 1000).toISOString();
}

function toPublicOrder(order: z.infer<typeof orderSchema>): Order {
  return {
    id: order.trade_no,
    status: STATUS_MAP[order.status],
    amountMinor: order.total_amount,
    createdAt: toIsoTimestamp(order.created_at),
    updatedAt:
      order.updated_at === null ? null : toIsoTimestamp(order.updated_at),
    expiresAt:
      order.expires_at === null || order.expires_at === undefined
        ? null
        : toIsoTimestamp(order.expires_at),
  };
}

function errorMessage(payload: z.infer<typeof orderErrorSchema>): string | undefined {
  return payload.message ?? payload.error;
}

export class V2BoardOrdersAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async orders(authToken: string): Promise<Order[]> {
    const { response, payload } = await this.requestJson('user/order/fetch', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthenticatedResponse(response);

    if (!response.ok) {
      if (!orderErrorSchema.safeParse(payload).success) {
        throw new V2BoardUpstreamError();
      }
      throw new V2BoardOrderQueryError();
    }

    const parsed = ordersResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new V2BoardUpstreamError();
    }

    return parsed.data.data.map(toPublicOrder);
  }

  async createOrder(
    authToken: string,
    request: CreateOrderRequest
  ): Promise<CreatedOrder> {
    const { response, payload } = await this.requestJson('user/order/save', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_id: Number(request.productId),
        period: PERIOD_MAP[request.billingPeriod],
      }),
    });
    this.assertAuthenticatedResponse(response);

    if (!response.ok) {
      if (!orderErrorSchema.safeParse(payload).success) {
        throw new V2BoardUpstreamError();
      }
      throw new V2BoardOrderCreateError();
    }

    const parsed = createdOrderResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new V2BoardUpstreamError();
    }

    return { id: parsed.data.data };
  }

  async order(authToken: string, id: string): Promise<Order> {
    const path = `user/order/detail?trade_no=${encodeURIComponent(id)}`;
    const { response, payload } = await this.requestJson(path, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthenticatedResponse(response);

    if (!response.ok) {
      const parsedError = orderErrorSchema.safeParse(payload);
      if (!parsedError.success) {
        throw new V2BoardUpstreamError();
      }

      const message = errorMessage(parsedError.data)?.trim().toLowerCase();
      if (message && ORDER_NOT_FOUND_MESSAGES.has(message)) {
        throw new V2BoardOrderNotFoundError();
      }
      throw new V2BoardOrderQueryError();
    }

    const parsed = orderResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new V2BoardUpstreamError();
    }

    return toPublicOrder(parsed.data.data);
  }
}
