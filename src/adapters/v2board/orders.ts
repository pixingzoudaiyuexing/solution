import { z } from 'zod';
import type { Order, OrderStatus } from '../../contract/v1/orders';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
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
    trade_no: z.string().min(1).max(128),
    status: orderStatusSchema,
    total_amount: z.number().int().nonnegative(),
    created_at: timestampSchema,
    updated_at: timestampSchema.nullable(),
  })
  .strip();
const ordersResponseSchema = z
  .object({ data: z.array(orderSchema) })
  .strip();
const orderErrorSchema = z.object({}).strip();

const STATUS_MAP: Record<z.infer<typeof orderStatusSchema>, OrderStatus> = {
  0: 'pending',
  1: 'processing',
  2: 'cancelled',
  3: 'completed',
  4: 'adjusted',
};

function toIsoTimestamp(value: number): string {
  return new Date(value * 1000).toISOString();
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

    return parsed.data.data.map((order) => ({
      id: order.trade_no,
      status: STATUS_MAP[order.status],
      amountMinor: order.total_amount,
      createdAt: toIsoTimestamp(order.created_at),
      updatedAt:
        order.updated_at === null ? null : toIsoTimestamp(order.updated_at),
    }));
  }
}
