import { z } from 'zod';
import type { SubscriptionOverview } from '../../contract/v1/subscription';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import { V2BoardUpstreamError } from './errors';

const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const boundedIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(2_147_483_647);
const timestampSchema = z
  .number()
  .int()
  .nonnegative()
  .max(253402300799);
const productSchema = z
  .object({
    id: z.number().int().positive().max(2_147_483_647),
    name: z.string().min(1).max(255),
  })
  .strip();
const renewalSchema = z
  .union([z.literal(0), z.literal(1), z.literal('0'), z.literal('1')])
  .transform((value) => value === 1 || value === '1');
const overviewDataSchema = z
  .object({
    plan_id: z
      .number()
      .int()
      .nonnegative()
      .max(2_147_483_647)
      .nullable(),
    plan: productSchema.optional(),
    expired_at: timestampSchema.nullable(),
    u: safeCountSchema,
    d: safeCountSchema,
    transfer_enable: safeCountSchema,
    device_limit: boundedIntegerSchema.nullable(),
    alive_ip: boundedIntegerSchema,
    reset_day: boundedIntegerSchema.nullable(),
    allow_new_period: renewalSchema,
  })
  .strip()
  .superRefine((value, context) => {
    const hasPlan = value.plan_id !== null && value.plan_id > 0;
    if (hasPlan && (!value.plan || value.plan.id !== value.plan_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Plan does not match plan_id',
      });
    }
    if (!hasPlan && value.plan !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unexpected plan for user without plan_id',
      });
    }
  });
const overviewResponseSchema = z.object({ data: overviewDataSchema }).strip();

function isoTimestamp(value: number | null): string | null {
  return value === null ? null : new Date(value * 1000).toISOString();
}

export class V2BoardSubscriptionOverviewAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async overview(authToken: string): Promise<SubscriptionOverview> {
    const { response, payload } = await this.requestJson('user/getSubscribe', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);
    const parsed = overviewResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    const data = parsed.data.data;
    return {
      product: data.plan
        ? { id: String(data.plan.id), name: data.plan.name }
        : null,
      expiresAt: isoTimestamp(data.expired_at),
      traffic: {
        uploadedBytes: data.u,
        downloadedBytes: data.d,
        allowanceBytes: data.transfer_enable,
      },
      deviceLimit: data.device_limit,
      activeDevices: data.alive_ip,
      resetDay: data.reset_day,
      renewalAllowed: data.allow_new_period,
    };
  }
}
