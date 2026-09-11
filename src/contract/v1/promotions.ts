export interface ValidatePromotionRequest {
  code: string;
  productId: number;
}

export type PromotionDiscount =
  | { type: 'fixed'; amountMinor: number }
  | { type: 'percentage'; percent: number };

export interface ValidPromotion {
  valid: true;
  discount: PromotionDiscount;
}

export interface ValidatePromotionSuccessResponse {
  ok: true;
  data: ValidPromotion;
  requestId: string;
}
