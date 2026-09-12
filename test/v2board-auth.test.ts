import { afterEach, describe, expect, it, vi } from 'vitest';
import { V2BoardAuthAdapter } from '../src/adapters/v2board/auth';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardAuthenticationError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
  V2BoardValidationError,
} from '../src/adapters/v2board/errors';

afterEach(() => {
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardAuthAdapter {
  return new V2BoardAuthAdapter(
    new V2BoardClient(
      { baseUrl: 'https://private.example/api/v1/' },
      fetcher
    )
  );
}

describe('V2BoardAuthAdapter login', () => {
  it('maps root auth_data to the public access token DTO', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ auth_data: 'token-value' })
    );
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.login({ email: 'user@example.com', password: 'password123' })
    ).resolves.toEqual({
      accessToken: 'token-value',
      tokenType: 'Bearer',
    });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://private.example/api/v1/passport/auth/login');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'user@example.com',
      password: 'password123',
    });
  });

  it('maps the V2Board data envelope without exposing sibling fields', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: {
            auth_data: 'token-value',
            token: 'legacy-token',
            is_admin: true,
          },
        })
      )
    );

    await expect(
      adapter.login({ email: 'user@example.com', password: 'password123' })
    ).resolves.toEqual({
      accessToken: 'token-value',
      tokenType: 'Bearer',
    });
  });

  it.each([
    'Incorrect email or password',
    'Your account has been suspended',
    '邮箱或密码错误',
    '该账户已被停止使用',
  ])('maps a known V2Board JSON auth error: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message }, 500)
      )
    );

    await expect(
      adapter.login({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardAuthenticationError);
  });

  it.each([
    'There are too many password errors, please try again after 1 minutes.',
    'There are too many password errors, please try again after 60 minutes.',
    '密码错误次数过多，请 1 分钟后再试',
    '密码错误次数过多，请 120 分钟后再试',
  ])('maps an exact dynamic login limit error: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    await expect(
      adapter.login({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardAuthenticationError);
  });

  it.each([
    'There are too many password errors SOMETHING ELSE',
    'There are too many password errors, please try again later.',
    '密码错误次数过多，请稍后重试',
    '密码错误次数过多，请 x 分钟后再试',
  ])('does not classify a dynamic login limit near-miss: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    await expect(
      adapter.login({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('maps an upstream validation rejection without exposing its payload', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ errors: { password: ['internal detail'] } }, 422)
      )
    );

    await expect(
      adapter.login({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardValidationError);
  });

  it('normalizes an unknown JSON 500 response', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'SQL connection failed' }, 500)
      )
    );

    await expect(
      adapter.login({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('normalizes an HTML error response', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>Laravel exception</h1>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    );

    await expect(
      adapter.login({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('normalizes a fetch timeout', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockRejectedValue(
        new DOMException('The operation timed out', 'TimeoutError')
      )
    );

    await expect(
      adapter.login({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });

  it('normalizes invalid JSON from a successful response', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{invalid-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    await expect(
      adapter.login({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });
});

describe('V2BoardAuthAdapter current user', () => {
  it('forwards the opaque token and maps only the public email field', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T00:00:00.000Z'));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          email: 'user@example.com',
          uuid: 'private-uuid',
          expired_at: 1893456000,
          banned: 0,
          balance: 10000,
        },
      })
    );
    const adapter = createAdapter(fetcher);

    await expect(adapter.currentUser('opaque-token')).resolves.toEqual({
      email: 'user@example.com',
      expiresAt: '2030-01-01T00:00:00.000Z',
      status: 'active',
    });

    const [url, init] = fetcher.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(url).toBe('https://private.example/api/v1/user/info');
    expect(init?.redirect).toBe('manual');
    expect(headers.get('authorization')).toBe('opaque-token');
    expect(headers.has('cookie')).toBe(false);
  });

  it.each([
    [1, 1, 'disabled'],
    [0, 1, 'expired'],
  ] as const)(
    'maps banned=%s and expired_at=%s to %s',
    async (banned, expiredAt, status) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({
            data: {
              email: 'user@example.com',
              expired_at: expiredAt,
              banned,
              uuid: 'private-uuid',
            },
          })
        )
      );

      await expect(adapter.currentUser('opaque-token')).resolves.toEqual({
        email: 'user@example.com',
        expiresAt: '1970-01-01T00:00:01.000Z',
        status,
      });
    }
  );
});
