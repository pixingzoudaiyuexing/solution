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
const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();

const INVALID_PROMOTION_MESSAGES = new Set([
  'coupon cannot be empty',
  '优惠券不能为空',
  'invalid coupon',
  '优惠券无效',
  'this coupon is no longer available',
  '优惠券已无可用次数',
  'this coupon has not yet started',
  '优惠券还未到可用时间',
  'this coupon has expired',
  '优惠券已过期',
  'the coupon code cannot be used for this subscription',
  '该订阅无法使用此优惠码',
  'the coupon code cannot be used for this period',
  '此优惠券无法用于该付款周期',
]);

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
      const parsed = errorResponseSchema.safeParse(payload);
      const message = parsed.success
        ? (parsed.data.message ?? parsed.data.error)?.trim().toLowerCase()
        : undefined;
      if (message && INVALID_PROMOTION_MESSAGES.has(message)) {
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
