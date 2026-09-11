import type { ErrorHandler } from 'hono';
import {
  GatewayError,
  publicErrorResponse,
  upstreamErrorResponse,
} from '../contract/error';
import {
  V2BoardAuthenticationError,
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
  V2BoardRegistrationUnavailableError,
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
