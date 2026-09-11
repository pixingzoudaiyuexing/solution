import type { ErrorHandler } from 'hono';
import {
  GatewayError,
  publicErrorResponse,
  upstreamErrorResponse,
} from '../contract/error';
import {
  V2BoardAuthenticationError,
  V2BoardCommissionTransferError,
  V2BoardGiftCardAlreadyRedeemedError,
  V2BoardGiftCardExpiredError,
  V2BoardGiftCardNotActiveError,
  V2BoardGiftCardNotApplicableError,
  V2BoardGiftCardNotFoundError,
  V2BoardGiftCardRedeemError,
  V2BoardGiftCardUsageLimitError,
  V2BoardInsufficientCommissionBalanceError,
  V2BoardNoticeNotFoundError,
  V2BoardOrderCreateError,
  V2BoardOrderCancelError,
  V2BoardOrderExpiredError,
  V2BoardOrderNotFoundError,
  V2BoardOrderNotCancellableError,
  V2BoardOrderQueryError,
  V2BoardPasswordResetError,
  V2BoardPasswordChangeError,
  V2BoardPaymentCreateError,
  V2BoardPaymentMethodUnavailableError,
  V2BoardRateLimitedError,
  V2BoardReferralCodeLimitError,
  V2BoardRegistrationUnavailableError,
  V2BoardSubscriptionAccessUnavailableError,
  V2BoardSubscriptionRotationError,
  V2BoardTicketCloseError,
  V2BoardTicketCreateError,
  V2BoardTicketNotFoundError,
  V2BoardTicketReplyError,
  V2BoardTicketUnavailableError,
  V2BoardPromotionInvalidError,
  V2BoardPreferencesUpdateError,
  V2BoardTimeoutError,
  V2BoardValidationError,
  V2BoardVerificationError,
  V2BoardWithdrawalDisabledError,
  V2BoardWithdrawalMethodUnsupportedError,
  V2BoardWithdrawalMinimumNotMetError,
  V2BoardWithdrawalRequestError,
} from '../adapters/v2board/errors';
import { requestId } from './request-id';

export const errorHandler: ErrorHandler = (err, c) => {
  const id = requestId(c);
  c.header('Cache-Control', 'no-store');

  if (err instanceof GatewayError) {
    return c.json(
      publicErrorResponse(err.code, err.publicMessage, id),
      err.status
    );
  }

  if (err instanceof V2BoardAuthenticationError) {
    return c.json(
      publicErrorResponse('AUTH_FAILED', 'Authentication failed', id),
      401
    );
  }

  if (err instanceof V2BoardInsufficientCommissionBalanceError) {
    return c.json(
      publicErrorResponse(
        'INSUFFICIENT_COMMISSION_BALANCE',
        'Commission balance is insufficient',
        id
      ),
      409
    );
  }

  if (err instanceof V2BoardCommissionTransferError) {
    return c.json(
      publicErrorResponse(
        'COMMISSION_TRANSFER_FAILED',
        'Unable to transfer commission',
        id
      ),
      502
    );
  }

  if (err instanceof V2BoardWithdrawalDisabledError) {
    return c.json(
      publicErrorResponse(
        'WITHDRAWAL_DISABLED',
        'Withdrawal requests are unavailable',
        id
      ),
      409
    );
  }

  if (err instanceof V2BoardWithdrawalMethodUnsupportedError) {
    return c.json(
      publicErrorResponse(
        'WITHDRAWAL_METHOD_UNSUPPORTED',
        'Selected withdrawal method is unavailable',
        id
      ),
      422
    );
  }

  if (err instanceof V2BoardWithdrawalMinimumNotMetError) {
    return c.json(
      publicErrorResponse(
        'WITHDRAWAL_MINIMUM_NOT_MET',
        'Withdrawal minimum has not been met',
        id
      ),
      409
    );
  }

  if (err instanceof V2BoardWithdrawalRequestError) {
    return c.json(
      publicErrorResponse(
        'WITHDRAWAL_REQUEST_FAILED',
        'Unable to create withdrawal request',
        id
      ),
      502
    );
  }

  if (err instanceof V2BoardSubscriptionAccessUnavailableError) {
    return c.json(
      publicErrorResponse(
        'SUBSCRIPTION_ACCESS_UNAVAILABLE',
        'Subscription access is unavailable',
        id
      ),
      409
    );
  }

  if (err instanceof V2BoardSubscriptionRotationError) {
    return c.json(
      publicErrorResponse(
        'SUBSCRIPTION_ROTATION_FAILED',
        'Unable to rotate subscription access',
        id
      ),
      502
    );
  }

  if (err instanceof V2BoardGiftCardNotFoundError) {
    return c.json(
      publicErrorResponse('GIFT_CARD_NOT_FOUND', 'Gift card unavailable', id),
      404
    );
  }

  if (err instanceof V2BoardGiftCardNotActiveError) {
    return c.json(
      publicErrorResponse('GIFT_CARD_NOT_ACTIVE', 'Gift card is not active', id),
      409
    );
  }

  if (err instanceof V2BoardGiftCardExpiredError) {
    return c.json(
      publicErrorResponse('GIFT_CARD_EXPIRED', 'Gift card has expired', id),
      409
    );
  }

  if (err instanceof V2BoardGiftCardUsageLimitError) {
    return c.json(
      publicErrorResponse(
        'GIFT_CARD_USAGE_LIMIT_REACHED',
        'Gift card usage limit reached',
        id
      ),
      409
    );
  }

  if (err instanceof V2BoardGiftCardAlreadyRedeemedError) {
    return c.json(
      publicErrorResponse(
        'GIFT_CARD_ALREADY_REDEEMED',
        'Gift card already redeemed',
        id
      ),
      409
    );
  }

  if (err instanceof V2BoardGiftCardNotApplicableError) {
    return c.json(
      publicErrorResponse(
        'GIFT_CARD_NOT_APPLICABLE',
        'Gift card is not applicable',
        id
      ),
      409
    );
  }

  if (err instanceof V2BoardGiftCardRedeemError) {
    return c.json(
      publicErrorResponse(
        'GIFT_CARD_REDEEM_FAILED',
        'Unable to redeem gift card',
        id
      ),
      502
    );
  }

  if (err instanceof V2BoardNoticeNotFoundError) {
    return c.json(
      publicErrorResponse(
        'NOTICE_NOT_FOUND',
        'Requested notice unavailable',
        id
      ),
      404
    );
  }

  if (err instanceof V2BoardValidationError) {
    return c.json(
      publicErrorResponse('VALIDATION_ERROR', 'Invalid request', id),
      400
    );
  }

  if (err instanceof V2BoardRegistrationUnavailableError) {
    return c.json(
      publicErrorResponse(
        'REGISTRATION_UNAVAILABLE',
        'Registration unavailable',
        id
      ),
      409
    );
  }

  if (err instanceof V2BoardVerificationError) {
    return c.json(
      publicErrorResponse('VERIFICATION_FAILED', 'Verification failed', id),
      422
    );
  }

  if (err instanceof V2BoardRateLimitedError) {
    return c.json(
      publicErrorResponse('RATE_LIMITED', 'Too many requests', id),
      429
    );
  }

  if (err instanceof V2BoardReferralCodeLimitError) {
    return c.json(
      publicErrorResponse(
        'REFERRAL_CODE_LIMIT_REACHED',
        'Referral code limit reached',
        id
      ),
      409
    );
  }

  if (err instanceof V2BoardPasswordResetError) {
    return c.json(
      publicErrorResponse(
        'PASSWORD_RESET_FAILED',
        'Unable to reset password',
        id
      ),
      422
    );
  }

  if (err instanceof V2BoardPasswordChangeError) {
    return c.json(
      publicErrorResponse(
        'PASSWORD_CHANGE_FAILED',
        'Unable to change password',
        id
      ),
      422
    );
  }

  if (err instanceof V2BoardPreferencesUpdateError) {
    return c.json(
      publicErrorResponse(
        'PREFERENCES_UPDATE_FAILED',
        'Unable to update preferences',
        id
      ),
      502
    );
  }

  if (err instanceof V2BoardTimeoutError) {
    return c.json(
      publicErrorResponse(
        'UPSTREAM_TIMEOUT',
        'The upstream service timed out',
        id
      ),
      504
    );
  }

  if (err instanceof V2BoardOrderQueryError) {
    return c.json(
      publicErrorResponse(
        'ORDER_QUERY_FAILED',
        'Unable to retrieve orders',
        id
      ),
      502
    );
  }

  if (err instanceof V2BoardOrderCreateError) {
    return c.json(
      publicErrorResponse(
        'ORDER_CREATE_FAILED',
        'Unable to create order',
        id
      ),
      502
    );
  }

  if (err instanceof V2BoardOrderNotCancellableError) {
    return c.json(
      publicErrorResponse(
        'ORDER_NOT_CANCELLABLE',
        'Order cannot be cancelled',
        id
      ),
      409
    );
  }

  if (err instanceof V2BoardOrderCancelError) {
    return c.json(
      publicErrorResponse('ORDER_CANCEL_FAILED', 'Unable to cancel order', id),
      502
    );
  }

  if (err instanceof V2BoardPromotionInvalidError) {
    return c.json(
      publicErrorResponse('PROMOTION_INVALID', 'Promotion is not valid', id),
      422
    );
  }

  if (err instanceof V2BoardOrderNotFoundError) {
    return c.json(
      publicErrorResponse('ORDER_NOT_FOUND', 'Order not found', id),
      404
    );
  }

  if (err instanceof V2BoardOrderExpiredError) {
    return c.json(
      publicErrorResponse('ORDER_EXPIRED', 'Order has expired', id),
      409
    );
  }

  if (err instanceof V2BoardPaymentMethodUnavailableError) {
    return c.json(
      publicErrorResponse(
        'PAYMENT_METHOD_UNAVAILABLE',
        'Payment method unavailable',
        id
      ),
      422
    );
  }

  if (err instanceof V2BoardPaymentCreateError) {
    return c.json(
      publicErrorResponse(
        'PAYMENT_CREATE_FAILED',
        'Unable to create payment',
        id
      ),
      502
    );
  }

  if (err instanceof V2BoardTicketNotFoundError) {
    return c.json(
      publicErrorResponse('TICKET_NOT_FOUND', 'Ticket not found', id),
      404
    );
  }

  if (err instanceof V2BoardTicketUnavailableError) {
    return c.json(
      publicErrorResponse('TICKET_UNAVAILABLE', 'Ticket unavailable', id),
      409
    );
  }

  if (err instanceof V2BoardTicketCreateError) {
    return c.json(
      publicErrorResponse('TICKET_CREATE_FAILED', 'Unable to create ticket', id),
      502
    );
  }

  if (err instanceof V2BoardTicketReplyError) {
    return c.json(
      publicErrorResponse('TICKET_REPLY_FAILED', 'Unable to reply to ticket', id),
      409
    );
  }

  if (err instanceof V2BoardTicketCloseError) {
    return c.json(
      publicErrorResponse('TICKET_CLOSE_FAILED', 'Unable to close ticket', id),
      502
    );
  }

  console.error('Unhandled gateway error', {
    errorName: err.name || 'Error',
    requestId: id,
  });

  return c.json(upstreamErrorResponse(id), 502);
};
