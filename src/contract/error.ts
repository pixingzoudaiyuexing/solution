export interface PublicErrorResponse {
  ok: false;
  error: {
    code: 'UPSTREAM_ERROR';
    message: string;
    requestId: string;
  };
}

export function upstreamErrorResponse(requestId: string): PublicErrorResponse {
  return {
    ok: false,
    error: {
      code: 'UPSTREAM_ERROR',
      message: 'The upstream service could not complete the request',
      requestId,
    },
  };
}
