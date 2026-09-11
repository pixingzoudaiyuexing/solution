import { describe, expect, it, vi } from 'vitest';
import { V2BoardAuthAdapter } from '../src/adapters/v2board/auth';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardPasswordResetError,
  V2BoardRateLimitedError,
  V2BoardRegistrationUnavailableError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
  V2BoardVerificationError,
} from '../src/adapters/v2board/errors';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardAuthAdapter {
  return new V2BoardAuthAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

function requestDetails(fetcher: ReturnType<typeof vi.fn<typeof fetch>>) {
  const [url, init] = fetcher.mock.calls[0];
  return {
    url,
    init,
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)),
  };
}

describe('V2BoardAuthAdapter email code', () => {
  it.each([
    ['register', 0],
    ['password-reset', 1],
  ] as const)('maps purpose %s to isforget=%s', async (purpose, isforget) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true }));
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.sendEmailCode({ email: 'user@example.com', purpose })
    ).resolves.toEqual({ sent: true });

    const { url, init, headers, body } = requestDetails(fetcher);
    expect(url).toBe(
      'https://backend.example/api/v1/passport/comm/sendEmailVerify'
    );
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('host')).toBe(false);
    expect(body).toEqual({ email: 'user@example.com', isforget });
  });

  it('maps optional recaptcha data without forwarding extra fields', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true, internal: 'ignored' }));
    const adapter = createAdapter(fetcher);

    await adapter.sendEmailCode({
      email: 'user@example.com',
      purpose: 'register',
      recaptchaData: 'captcha-value',
    });

    expect(requestDetails(fetcher).body).toEqual({
      email: 'user@example.com',
      isforget: 0,
      recaptcha_data: 'captcha-value',
    });
  });

  it.each([
    [429, 'Too many requests, please try again later.'],
    [500, 'Email verification code has been sent, please request again later'],
  ])('maps resend throttling to rate limited', async (status, message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, status))
    );
    await expect(
      adapter.sendEmailCode({ email: 'user@example.com', purpose: 'register' })
    ).rejects.toBeInstanceOf(V2BoardRateLimitedError);
  });

  it('normalizes unknown failures and timeouts', async () => {
    const unknown = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: 'Database unavailable' }, 500))
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );

    await expect(
      unknown.sendEmailCode({ email: 'user@example.com', purpose: 'register' })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timeout.sendEmailCode({ email: 'user@example.com', purpose: 'register' })
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });

  it('rejects a malformed success response', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: false }))
    );
    await expect(
      adapter.sendEmailCode({ email: 'user@example.com', purpose: 'register' })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });
});

describe('V2BoardAuthAdapter registration', () => {
  it('maps the minimal request and returns the login auth DTO', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          auth_data: 'opaque-auth-data',
          token: 'private-subscription-token',
          is_admin: false,
        },
      })
    );
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.register({ email: 'user@example.com', password: 'password123' })
    ).resolves.toEqual({ accessToken: 'opaque-auth-data', tokenType: 'Bearer' });
    expect(requestDetails(fetcher).body).toEqual({
      email: 'user@example.com',
      password: 'password123',
    });
  });

  it('maps all optional registration fields', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { auth_data: 'opaque' } }));
    const adapter = createAdapter(fetcher);

    await adapter.register({
      email: 'user@example.com',
      password: 'password123',
      emailCode: '123456',
      inviteCode: 'ABCDEF',
      recaptchaData: 'captcha-value',
    });

    expect(requestDetails(fetcher).body).toEqual({
      email: 'user@example.com',
      password: 'password123',
      email_code: '123456',
      invite_code: 'ABCDEF',
      recaptcha_data: 'captcha-value',
    });
  });

  it.each([
    'Email already exists',
    'Registration has closed',
    'You must use the invitation code to register',
    'Invalid invitation code',
  ])('maps registration unavailable exactly: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    await expect(
      adapter.register({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardRegistrationUnavailableError);
  });

  it('maps exact verification failure', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Incorrect email verification code' }, 500)
      )
    );
    await expect(
      adapter.register({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardVerificationError);
  });

  it('does not classify a message that only contains a known error', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Email already exists: user@example.com' }, 500)
      )
    );
    await expect(
      adapter.register({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('normalizes unknown failures and timeouts', async () => {
    const unknown = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Internal registration exception' }, 500)
      )
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );

    await expect(
      unknown.register({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timeout.register({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });

  it('rejects a malformed success response', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: true }))
    );
    await expect(
      adapter.register({ email: 'user@example.com', password: 'password123' })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });
});

describe('V2BoardAuthAdapter password reset', () => {
  it('maps the request and returns reset=true', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true, internal: 'ignored' }));
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.resetPassword({
        email: 'user@example.com',
        emailCode: '123456',
        newPassword: 'new-password123',
      })
    ).resolves.toEqual({ reset: true });

    const { url, body } = requestDetails(fetcher);
    expect(url).toBe('https://backend.example/api/v1/passport/auth/forget');
    expect(body).toEqual({
      email: 'user@example.com',
      email_code: '123456',
      password: 'new-password123',
    });
  });

  it('maps exact verification failure', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Incorrect email verification code' }, 500)
      )
    );
    await expect(
      adapter.resetPassword({
        email: 'user@example.com',
        emailCode: '123456',
        newPassword: 'new-password123',
      })
    ).rejects.toBeInstanceOf(V2BoardVerificationError);
  });

  it('maps unknown user and attempt limit without leaking messages', async () => {
    const unknownUser = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'This email is not registered in the system' }, 500)
      )
    );
    const limited = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Reset failed, Please try again later' }, 500)
      )
    );
    const request = {
      email: 'user@example.com',
      emailCode: '123456',
      newPassword: 'new-password123',
    };

    await expect(unknownUser.resetPassword(request)).rejects.toBeInstanceOf(
      V2BoardPasswordResetError
    );
    await expect(limited.resetPassword(request)).rejects.toBeInstanceOf(
      V2BoardRateLimitedError
    );
  });

  it('normalizes unknown failures and timeouts', async () => {
    const unknown = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: 'Database unavailable' }, 500))
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const request = {
      email: 'user@example.com',
      emailCode: '123456',
      newPassword: 'new-password123',
    };

    await expect(unknown.resetPassword(request)).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(timeout.resetPassword(request)).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });

  it('rejects a malformed success response', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: false }))
    );
    await expect(
      adapter.resetPassword({
        email: 'user@example.com',
        emailCode: '123456',
        newPassword: 'new-password123',
      })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });
});
