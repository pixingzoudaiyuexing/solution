import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';

const env = {
  V2BOARD_BASE_URL: 'https://private.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function currentUserResponse(): Response {
  return jsonResponse({
    data: {
      email: 'user@example.com',
      expired_at: null,
      banned: 0,
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('authentication security regressions', () => {
  it('does not retain an opaque token between requests', async () => {
    const authorizationHeaders: Array<string | null> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      authorizationHeaders.push(new Headers(init?.headers).get('authorization'));
      return Promise.resolve(currentUserResponse());
    });
    vi.stubGlobal('fetch', fetcher);

    for (const token of ['first-opaque-token', 'second-opaque-token']) {
      const response = await app.request(
        '/api/v1/me',
        { headers: { Authorization: `Bearer ${token}` } },
        env
      );
      expect(response.status).toBe(200);
    }

    expect(authorizationHeaders).toEqual([
      'first-opaque-token',
      'second-opaque-token',
    ]);
  });

  it('does not write passwords or tokens to application logs', async () => {
    const password = 'sensitive-password';
    const token = 'sensitive-opaque-token';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ data: { auth_data: token } }))
        .mockResolvedValueOnce(
          new Response('<h1>Internal failure</h1>', { status: 500 })
        )
    );

    await app.request(
      '/api/v1/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password }),
      },
      env
    );
    await app.request(
      '/api/v1/me',
      { headers: { Authorization: `Bearer ${token}` } },
      env
    );

    const logged = JSON.stringify([
      ...log.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]);
    expect(logged).not.toContain(password);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain('Internal failure');
    expect(logged).not.toContain('private.example');
  });

  it('does not log account lifecycle credentials or verification data', async () => {
    const sensitive = {
      password: 'sensitive-register-password',
      newPassword: 'sensitive-reset-password',
      emailCode: '654321',
      challengeToken: 'sensitive-challenge-token',
      inviteCode: 'sensitive-invite-code',
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>Internal lifecycle failure</h1>', { status: 500 })
      )
    );

    await app.request(
      '/api/v1/auth/email-code',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          purpose: 'register',
          challengeToken: sensitive.challengeToken,
        }),
      },
      env
    );
    await app.request(
      '/api/v1/auth/register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password: sensitive.password,
          emailCode: sensitive.emailCode,
          inviteCode: sensitive.inviteCode,
          challengeToken: sensitive.challengeToken,
        }),
      },
      env
    );
    await app.request(
      '/api/v1/auth/password/reset',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          emailCode: sensitive.emailCode,
          newPassword: sensitive.newPassword,
        }),
      },
      env
    );

    const logged = JSON.stringify([
      ...log.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]);
    for (const value of Object.values(sensitive)) {
      expect(logged).not.toContain(value);
    }
    expect(logged).not.toContain('Internal lifecycle failure');
    expect(logged).not.toContain('backend.example');
  });

  it.each([
    'Basic opaque-token',
    'Bearer',
    'Bearer token with-spaces',
  ])('rejects a malformed Authorization value: %s', async (authorization) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/me',
      { headers: { Authorization: authorization } },
      env
    );

    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
