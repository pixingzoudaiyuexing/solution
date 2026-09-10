export interface V2BoardClientConfig {
  baseUrl: string;
  accessClientId?: string;
  accessClientSecret?: string;
}

const FORWARDED_HEADERS = ['accept', 'authorization', 'content-type'] as const;

export class UpstreamRedirectError extends Error {
  constructor() {
    super('Upstream redirect rejected');
    this.name = 'UpstreamRedirectError';
  }
}

export class V2BoardClient {
  private readonly baseUrl: URL;

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

    if (!this.baseUrl.pathname.endsWith('/')) {
      this.baseUrl.pathname += '/';
    }
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = this.resolvePath(path);
    const headers = this.buildHeaders(init?.headers);

    const response = await this.fetcher(url.toString(), {
      ...init,
      headers,
      redirect: 'manual',
    });

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
