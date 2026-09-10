export interface V2BoardClientConfig {
  baseUrl: string;
  accessClientId?: string;
  accessClientSecret?: string;
  timeoutMs?: number;
}

const FORWARDED_HEADERS = ['accept', 'authorization', 'content-type'] as const;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface V2BoardRequestInit extends RequestInit {
  trustedOrigin?: string;
}

export class UpstreamRedirectError extends Error {
  constructor() {
    super('Upstream redirect rejected');
    this.name = 'UpstreamRedirectError';
  }
}

export class UpstreamTimeoutError extends Error {
  constructor() {
    super('Upstream request timed out');
    this.name = 'UpstreamTimeoutError';
  }
}

export class V2BoardClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: V2BoardClientConfig,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.baseUrl = new URL(config.baseUrl);

    if (this.baseUrl.protocol !== 'https:') {
      throw new Error('Upstream base URL must use HTTPS');
    }

    if (this.baseUrl.username || this.baseUrl.password) {
      throw new Error('Upstream base URL must not contain credentials');
    }

    if (Boolean(config.accessClientId) !== Boolean(config.accessClientSecret)) {
      throw new Error('Cloudflare Access credentials must be configured as a pair');
    }

    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Upstream timeout must be a positive integer');
    }

    if (!this.baseUrl.pathname.endsWith('/')) {
      this.baseUrl.pathname += '/';
    }
  }

  async fetch(path: string, init?: V2BoardRequestInit): Promise<Response> {
    const url = this.resolvePath(path);
    const headers = this.buildHeaders(init?.headers);
    const { trustedOrigin, ...fetchInit } = init ?? {};

    if (trustedOrigin !== undefined) {
      const origin = new URL(trustedOrigin);
      if (origin.origin !== trustedOrigin || origin.protocol !== 'https:') {
        throw new Error('Trusted upstream Origin must be an HTTPS origin');
      }
      headers.set('Origin', trustedOrigin);
    }
    const controller = new AbortController();
    const inputSignal = init?.signal;
    const forwardAbort = () => controller.abort(inputSignal?.reason);

    if (inputSignal?.aborted) {
      forwardAbort();
    } else {
      inputSignal?.addEventListener('abort', forwardAbort, { once: true });
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new UpstreamTimeoutError();
        controller.abort(error);
        reject(error);
      }, this.timeoutMs);
    });

    let response: Response;
    try {
      response = await Promise.race([
        this.fetcher(url.toString(), {
          ...fetchInit,
          headers,
          redirect: 'manual',
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      inputSignal?.removeEventListener('abort', forwardAbort);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new UpstreamRedirectError();
    }

    return response;
  }

  private resolvePath(path: string): URL {
    if (
      !path ||
      path.startsWith('/') ||
      path.startsWith('\\') ||
      /^[a-z][a-z\d+.-]*:/i.test(path)
    ) {
      throw new Error('Invalid upstream path');
    }

    const url = new URL(path, this.baseUrl);
    if (
      url.origin !== this.baseUrl.origin ||
      !url.pathname.startsWith(this.baseUrl.pathname)
    ) {
      throw new Error('Invalid upstream path');
    }

    return url;
  }

  private buildHeaders(input: HeadersInit | undefined): Headers {
    const source = new Headers(input);
    const headers = new Headers();

    for (const name of FORWARDED_HEADERS) {
      const value = source.get(name);
      if (value !== null) {
        headers.set(name, value);
      }
    }

    if (this.config.accessClientId && this.config.accessClientSecret) {
      headers.set('CF-Access-Client-Id', this.config.accessClientId);
      headers.set('CF-Access-Client-Secret', this.config.accessClientSecret);
    }

    return headers;
  }
}
