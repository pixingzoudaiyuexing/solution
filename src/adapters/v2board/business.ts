import { z } from 'zod';
import type {
  BillingPeriod,
  Product,
  ProductPrice,
} from '../../contract/product';
import type { PublicResource } from '../../contract/resource';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import { V2BoardUpstreamError } from './errors';

const optionalAmountSchema = z.number().int().nonnegative().nullable().optional();
const planSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    transfer_enable: z.number().int().nonnegative(),
    speed_limit: z.number().int().nonnegative().nullable().optional(),
    capacity_limit: z.number().int().nullable().optional(),
    month_price: optionalAmountSchema,
    quarter_price: optionalAmountSchema,
    half_year_price: optionalAmountSchema,
    year_price: optionalAmountSchema,
    two_year_price: optionalAmountSchema,
    three_year_price: optionalAmountSchema,
    onetime_price: optionalAmountSchema,
  })
  .strip();
const plansResponseSchema = z
  .object({ data: z.array(planSchema) })
  .strip();

const resourceSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    type: z.string().min(1),
    is_online: z.union([z.literal(0), z.literal(1), z.boolean()]),
  })
  .strip();
const resourcesResponseSchema = z
  .object({ data: z.array(resourceSchema) })
  .strip();

const PRICE_FIELDS: ReadonlyArray<
  readonly [
    keyof Pick<
      z.infer<typeof planSchema>,
      | 'month_price'
      | 'quarter_price'
      | 'half_year_price'
      | 'year_price'
      | 'two_year_price'
      | 'three_year_price'
      | 'onetime_price'
    >,
    BillingPeriod,
  ]
> = [
  ['month_price', 'month'],
  ['quarter_price', 'quarter'],
  ['half_year_price', 'halfYear'],
  ['year_price', 'year'],
  ['two_year_price', 'twoYears'],
  ['three_year_price', 'threeYears'],
  ['onetime_price', 'oneTime'],
];

function productPrices(plan: z.infer<typeof planSchema>): ProductPrice[] {
  return PRICE_FIELDS.flatMap(([field, billingPeriod]) => {
    const amountMinor = plan[field];
    return amountMinor === null || amountMinor === undefined
      ? []
      : [{ billingPeriod, amountMinor }];
  });
}

export class V2BoardBusinessAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async products(authToken: string): Promise<Product[]> {
    const { response, payload } = await this.requestJson('user/plan/fetch', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);
    const parsed = plansResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new V2BoardUpstreamError();
    }

    return parsed.data.data.map((plan) => ({
      id: String(plan.id),
      name: plan.name,
      dataAllowanceGb: plan.transfer_enable,
      speedLimitMbps: plan.speed_limit ?? null,
      available:
        plan.capacity_limit === null ||
        plan.capacity_limit === undefined ||
        plan.capacity_limit > 0,
      prices: productPrices(plan),
    }));
  }

  async resources(authToken: string): Promise<PublicResource[]> {
    const { response, payload } = await this.requestJson('user/server/fetch', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);
    const parsed = resourcesResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new V2BoardUpstreamError();
    }

    return parsed.data.data.map((resource) => ({
      id: String(resource.id),
      name: resource.name,
      category: resource.type,
      status:
        resource.is_online === true || resource.is_online === 1
          ? 'online'
          : 'offline',
    }));
  }
}
