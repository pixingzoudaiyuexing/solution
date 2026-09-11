export type PublicErrorCode =
  | 'AUTH_FAILED'
  | 'AUTH_REQUIRED'
  | 'ORDER_CREATE_FAILED'
  | 'ORDER_CANCEL_FAILED'
  | 'ORDER_EXPIRED'
  | 'ORDER_NOT_CANCELLABLE'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_QUERY_FAILED'
  | 'PAYMENT_CREATE_FAILED'
  | 'PAYMENT_METHOD_UNAVAILABLE'
  | 'PASSWORD_RESET_FAILED'
  | 'PROMOTION_INVALID'
  | 'RATE_LIMITED'
  | 'REGISTRATION_UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'VALIDATION_ERROR'
  | 'VERIFICATION_FAILED';

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
