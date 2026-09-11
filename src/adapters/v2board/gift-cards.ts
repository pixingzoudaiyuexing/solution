import { z } from 'zod';
import type { RedeemedGiftCard } from '../../contract/v1/gift-cards';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardGiftCardAlreadyRedeemedError,
  V2BoardGiftCardExpiredError,
  V2BoardGiftCardNotActiveError,
  V2BoardGiftCardNotApplicableError,
  V2BoardGiftCardNotFoundError,
  V2BoardGiftCardRedeemError,
  V2BoardGiftCardUsageLimitError,
  V2BoardUpstreamError,
} from './errors';

const effectValueSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const ignoredResetValueSchema = z
  .number()
  .int()
  .min(-2_147_483_648)
  .max(2_147_483_647)
  .nullable()
  .optional();
const successSchema = z.discriminatedUnion('type', [
  z.object({ data: z.literal(true), type: z.literal(1), value: effectValueSchema }).strip(),
  z.object({ data: z.literal(true), type: z.literal(2), value: effectValueSchema }).strip(),
  z.object({ data: z.literal(true), type: z.literal(3), value: effectValueSchema }).strip(),
  z.object({
    data: z.literal(true),
    type: z.literal(4),
    value: ignoredResetValueSchema,
  }).strip(),
  z.object({ data: z.literal(true), type: z.literal(5), value: effectValueSchema }).strip(),
]);
const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();

const NOT_FOUND_MESSAGES = new Set(['the gift card does not exist']);
const NOT_ACTIVE_MESSAGES = new Set(['the gift card is not yet valid']);
const EXPIRED_MESSAGES = new Set(['the gift card has expired']);
const USAGE_LIMIT_MESSAGES = new Set([
  'the gift card usage limit has been reached',
]);
const ALREADY_REDEEMED_MESSAGES = new Set([
  'the gift card has already been used by this user',
]);
const NOT_APPLICABLE_MESSAGES = new Set(['not suitable gift card type']);
const REDEEM_FAILED_MESSAGES = new Set([
  'giftcard cannot be empty',
  'unknown gift card type',
  'save failed',
  '保存失败',
  'the user does not exist',
  '该用户不存在',
]);

function errorMessage(payload: unknown): string | undefined {
  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  return (parsed.data.message ?? parsed.data.error)?.trim().toLowerCase();
}

export class V2BoardGiftCardsAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async redeem(authToken: string, code: string): Promise<RedeemedGiftCard> {
    const { response, payload } = await this.requestJson('user/redeemgiftcard', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ giftcard: code }),
    });
    this.assertAuthenticatedResponse(response);

    if (!response.ok) {
      this.throwMappedError(payload);
    }

    const parsed = successSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();

    switch (parsed.data.type) {
      case 1:
        return {
          redeemed: true,
          effect: { type: 'balance', amountMinor: parsed.data.value },
        };
      case 2:
        return {
          redeemed: true,
          effect: { type: 'validity', days: parsed.data.value },
        };
      case 3:
        return {
          redeemed: true,
          effect: { type: 'traffic', gigabytes: parsed.data.value },
        };
      case 4:
        return { redeemed: true, effect: { type: 'trafficReset' } };
      case 5:
        return {
          redeemed: true,
          effect: {
            type: 'plan',
            durationDays: parsed.data.value === 0 ? null : parsed.data.value,
          },
        };
    }
  }

  private throwMappedError(payload: unknown): never {
    const message = errorMessage(payload);
    if (!message) throw new V2BoardUpstreamError();
    if (NOT_FOUND_MESSAGES.has(message)) throw new V2BoardGiftCardNotFoundError();
    if (NOT_ACTIVE_MESSAGES.has(message)) throw new V2BoardGiftCardNotActiveError();
    if (EXPIRED_MESSAGES.has(message)) throw new V2BoardGiftCardExpiredError();
    if (USAGE_LIMIT_MESSAGES.has(message)) throw new V2BoardGiftCardUsageLimitError();
    if (ALREADY_REDEEMED_MESSAGES.has(message)) {
      throw new V2BoardGiftCardAlreadyRedeemedError();
    }
    if (NOT_APPLICABLE_MESSAGES.has(message)) {
      throw new V2BoardGiftCardNotApplicableError();
    }
    if (REDEEM_FAILED_MESSAGES.has(message)) throw new V2BoardGiftCardRedeemError();
    throw new V2BoardUpstreamError();
  }
}
