export type PublicErrorCode =
  | 'APPLE_ID_ACCOUNT_UNAVAILABLE'
  | 'APPLE_ID_PROVIDER_FAILURE'
  | 'APPLE_ID_UPSTREAM_INVALID'
  | 'APPLE_ID_UPSTREAM_UNREACHABLE'
  | 'AUTH_FAILED'
  | 'AUTH_REQUIRED'
  | 'COMMISSION_TRANSFER_FAILED'
  | 'GIFT_CARD_ALREADY_REDEEMED'
  | 'GIFT_CARD_EXPIRED'
  | 'GIFT_CARD_NOT_ACTIVE'
  | 'GIFT_CARD_NOT_APPLICABLE'
  | 'GIFT_CARD_NOT_FOUND'
  | 'GIFT_CARD_REDEEM_FAILED'
  | 'GIFT_CARD_USAGE_LIMIT_REACHED'
  | 'INSUFFICIENT_COMMISSION_BALANCE'
  | 'NOTICE_NOT_FOUND'
  | 'ORDER_CREATE_FAILED'
  | 'ORDER_CANCEL_FAILED'
  | 'ORDER_EXPIRED'
  | 'ORDER_NOT_CANCELLABLE'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_QUERY_FAILED'
  | 'PAYMENT_CREATE_FAILED'
  | 'PAYMENT_METHOD_UNAVAILABLE'
  | 'PASSWORD_RESET_FAILED'
  | 'PASSWORD_CHANGE_FAILED'
  | 'PREFERENCES_UPDATE_FAILED'
  | 'PROMOTION_INVALID'
  | 'PRODUCT_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'REFERRAL_CODE_LIMIT_REACHED'
  | 'REGISTRATION_UNAVAILABLE'
  | 'SUBSCRIPTION_ACCESS_UNAVAILABLE'
  | 'SUBSCRIPTION_ENTRY_UNAVAILABLE'
  | 'SUBSCRIPTION_PERIOD_ADVANCE_DISABLED'
  | 'SUBSCRIPTION_PERIOD_ADVANCE_FAILED'
  | 'SUBSCRIPTION_PERIOD_ADVANCE_UNAVAILABLE'
  | 'SUBSCRIPTION_ROTATION_FAILED'
  | 'SUBSCRIPTION_TRAFFIC_NOT_EXHAUSTED'
  | 'TICKET_CLOSE_FAILED'
  | 'TICKET_CREATE_FAILED'
  | 'TICKET_NOT_FOUND'
  | 'TICKET_REPLY_FAILED'
  | 'TICKET_UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'VERIFICATION_FAILED'
  | 'WALLET_DEPOSIT_AMOUNT_INVALID'
  | 'WALLET_DEPOSIT_CREATE_FAILED'
  | 'WALLET_DEPOSIT_UNAVAILABLE'
  | 'WITHDRAWAL_DISABLED'
  | 'WITHDRAWAL_METHOD_UNSUPPORTED'
  | 'WITHDRAWAL_MINIMUM_NOT_MET'
  | 'WITHDRAWAL_REQUEST_FAILED';

export interface PublicErrorResponse {
  ok: false;
  error: {
    code: PublicErrorCode;
    message: string;
    requestId: string;
  };
}

export class GatewayError extends Error {
  constructor(
    readonly status: 400 | 401,
    readonly code: 'AUTH_REQUIRED' | 'VALIDATION_ERROR',
    readonly publicMessage: string
  ) {
    super(publicMessage);
    this.name = 'GatewayError';
  }
}

export function publicErrorResponse(
  code: PublicErrorCode,
  message: string,
  requestId: string
): PublicErrorResponse {
  return {
    ok: false,
    error: { code, message, requestId },
  };
}

export function upstreamErrorResponse(requestId: string): PublicErrorResponse {
  return publicErrorResponse(
    'UPSTREAM_ERROR',
    'The upstream service could not complete the request',
    requestId
  );
}
