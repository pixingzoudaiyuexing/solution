import { z } from 'zod';

const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();

const COUPON_REJECTION_MESSAGES = new Set([
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
const COUPON_PER_USER_LIMIT_MESSAGES = [
  /^the coupon can only be used -?\d+ per person$/,
  /^该优惠券每人只能用 -?\d+ 次$/,
];

export function isCouponBusinessRejection(payload: unknown): boolean {
  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success) return false;
  const message = (parsed.data.message ?? parsed.data.error)
    ?.trim()
    .toLowerCase();
  return Boolean(
    message &&
      (COUPON_REJECTION_MESSAGES.has(message) ||
        COUPON_PER_USER_LIMIT_MESSAGES.some((pattern) => pattern.test(message)))
  );
}
