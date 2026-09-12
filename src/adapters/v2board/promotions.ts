import { z } from 'zod';
import type {
  ValidPromotion,
  ValidatePromotionRequest,
} from '../../contract/v1/promotions';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardPromotionInvalidError,
  V2BoardUpstreamError,
} from './errors';
import { isCouponBusinessRejection } from './coupon-errors';

const fixedCouponSchema = z
  .object({
    type: z.literal(1),
    value: z.number().int().nonnegative().max(2_147_483_647),
  })
  .strip();
const percentageCouponSchema = z
  .object({
    type: z.literal(2),
    value: z.number().int().nonnegative().max(2_147_483_647),
  })
  .strip();
const couponResponseSchema = z
  .object({ data: z.union([fixedCouponSchema, percentageCouponSchema]) })
  .strip();
export class V2BoardPromotionsAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async validatePromotion(
    authToken: string,
    request: ValidatePromotionRequest
  ): Promise<ValidPromotion> {
    const { response, payload } = await this.requestJson('user/coupon/check', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code: request.code, plan_id: request.productId }),
    });
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      if (isCouponBusinessRejection(payload)) {
        throw new V2BoardPromotionInvalidError();
      }
      throw new V2BoardUpstreamError();
    }

    const parsed = couponResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    const coupon = parsed.data.data;
    return coupon.type === 1
      ? {
          valid: true,
          discount: { type: 'fixed', amountMinor: coupon.value },
        }
      : {
          valid: true,
          discount: { type: 'percentage', percent: coupon.value },
        };
  }
}
