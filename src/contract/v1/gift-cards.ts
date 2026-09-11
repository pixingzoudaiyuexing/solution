export type GiftCardEffect =
  | { type: 'balance'; amountMinor: number }
  | { type: 'validity'; days: number }
  | { type: 'traffic'; gigabytes: number }
  | { type: 'trafficReset' }
  | { type: 'plan'; durationDays: number | null };

export interface RedeemGiftCardRequest {
  code: string;
}

export interface RedeemedGiftCard {
  redeemed: true;
  effect: GiftCardEffect;
}

export interface RedeemGiftCardSuccessResponse {
  ok: true;
  data: RedeemedGiftCard;
  requestId: string;
}
