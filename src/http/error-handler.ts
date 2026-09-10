import type { ErrorHandler } from 'hono';
import {
  GatewayError,
  publicErrorResponse,
  upstreamErrorResponse,
} from '../contract/error';
import {
  V2BoardAuthenticationError,
  V2BoardOrderQueryError,
  V2BoardTimeoutError,
  V2BoardValidationError,
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

  if (err instanceof V2BoardValidationError) {
    return c.json(
      publicErrorResponse('VALIDATION_ERROR', 'Invalid request', id),
      400
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

  console.error('Unhandled gateway error', {
    errorName: err.name || 'Error',
    requestId: id,
  });

  return c.json(upstreamErrorResponse(id), 502);
};
