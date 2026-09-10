import type { ErrorHandler } from 'hono';
import { upstreamErrorResponse } from '../contract/error';

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.req.header('cf-ray') || 'unknown';
  console.error('Unhandled gateway error', {
    errorName: err.name || 'Error',
    requestId,
  });

  return c.json(upstreamErrorResponse(requestId), 502);
};
