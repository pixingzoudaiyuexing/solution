import {
  UpstreamTimeoutError,
  V2BoardClient,
  type V2BoardRequestInit,
} from './client';
import {
  V2BoardAuthenticationError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from './errors';

export interface V2BoardJsonResponse {
  response: Response;
  payload: unknown;
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof UpstreamTimeoutError ||
    (error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'TimeoutError'))
  );
}

export abstract class V2BoardAdapterBase {
  constructor(protected readonly client: V2BoardClient) {}

  protected async request(
    path: string,
    init: V2BoardRequestInit,
    client: V2BoardClient = this.client
  ): Promise<Response> {
    try {
      return await client.fetch(path, init);
    } catch (error) {
      if (isTimeout(error)) {
        throw new V2BoardTimeoutError();
      }
      throw new V2BoardUpstreamError();
    }
  }

  protected async requestJson(
    path: string,
    init: V2BoardRequestInit
  ): Promise<V2BoardJsonResponse> {
    const response = await this.request(path, init);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new V2BoardUpstreamError();
    }

    return { response, payload };
  }

  protected assertAuthorizedResponse(response: Response): void {
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      throw new V2BoardUpstreamError();
    }
  }

  protected assertAuthenticatedResponse(response: Response): void {
    if (response.status === 401 || response.status === 403) {
      throw new V2BoardAuthenticationError();
    }
  }
}
