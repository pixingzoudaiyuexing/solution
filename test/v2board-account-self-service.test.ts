import { describe, expect, it, vi } from 'vitest';
import { V2BoardAccountAdapter } from '../src/adapters/v2board/account';
import { V2BoardAuthAdapter } from '../src/adapters/v2board/auth';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardPasswordChangeError,
  V2BoardPreferencesUpdateError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(fetcher: typeof fetch): V2BoardClient {
  return new V2BoardClient(
    { baseUrl: 'https://backend.example/api/v1/' },
    fetcher
  );
}

describe('V2BoardAuthAdapter change password', () => {
  it('maps both passwords and returns changed=true without issuing a token', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true, auth_data: 'must-ignore' }));
    const adapter = new V2BoardAuthAdapter(client(fetcher));

    await expect(
      adapter.changePassword('opaque-token', {
        currentPassword: 'old-password',
        newPassword: 'new-password',
      })
    ).resolves.toEqual({ changed: true });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/changePassword');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
    expect(JSON.parse(String(init?.body))).toEqual({
      old_password: 'old-password',
      new_password: 'new-password',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    'The old password is wrong',
    '旧密码有误',
    'The user does not exist',
    '该用户不存在',
    'Save failed',
    '保存失败',
  ])('maps exact password change failure: %s', async (message) => {
    const adapter = new V2BoardAuthAdapter(
      client(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
      )
    );
    await expect(
      adapter.changePassword('opaque-token', {
        currentPassword: 'old-password',
        newPassword: 'new-password',
      })
    ).rejects.toBeInstanceOf(V2BoardPasswordChangeError);
  });

  it('does not classify a message that only contains a known error', async () => {
    const adapter = new V2BoardAuthAdapter(
      client(
        vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({ message: 'Save failed: database unavailable' }, 500)
        )
      )
    );
    await expect(
      adapter.changePassword('opaque-token', {
        currentPassword: 'old-password',
        newPassword: 'new-password',
      })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('fails closed on malformed success, unknown error, and timeout', async () => {
    const request = {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    };
    const malformed = new V2BoardAuthAdapter(
      client(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: false })))
    );
    const unknown = new V2BoardAuthAdapter(
      client(
        vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({ message: 'Unexpected password error' }, 500)
        )
      )
    );
    const timeout = new V2BoardAuthAdapter(
      client(
        vi
          .fn<typeof fetch>()
          .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
      )
    );
    await expect(malformed.changePassword('opaque-token', request)).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(unknown.changePassword('opaque-token', request)).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(timeout.changePassword('opaque-token', request)).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });
});

describe('V2BoardAccountAdapter preferences', () => {
  it('maps all boolean preferences to numeric flags', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true }));
    const adapter = new V2BoardAccountAdapter(client(fetcher));

    await expect(
      adapter.updatePreferences('opaque-token', {
        autoRenewal: true,
        remindExpire: true,
        remindTraffic: false,
      })
    ).resolves.toEqual({ updated: true });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      auto_renewal: 1,
      remind_expire: 1,
      remind_traffic: 0,
    });
  });

  it.each([
    ['autoRenewal', true, 'auto_renewal', 1],
    ['autoRenewal', false, 'auto_renewal', 0],
    ['remindExpire', true, 'remind_expire', 1],
    ['remindExpire', false, 'remind_expire', 0],
    ['remindTraffic', true, 'remind_traffic', 1],
    ['remindTraffic', false, 'remind_traffic', 0],
  ] as const)(
    'maps only %s=%s without overwriting missing fields',
    async (publicKey, value, upstreamKey, upstreamValue) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ data: true }));
      const adapter = new V2BoardAccountAdapter(client(fetcher));
      await adapter.updatePreferences('opaque-token', { [publicKey]: value });
      expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
        [upstreamKey]: upstreamValue,
      });
    }
  );

  it.each(['Save failed', '保存失败', 'The user does not exist', '该用户不存在'])(
    'maps exact update failure: %s',
    async (message) => {
      const adapter = new V2BoardAccountAdapter(
        client(
          vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
        )
      );
      await expect(
        adapter.updatePreferences('opaque-token', { remindTraffic: false })
      ).rejects.toBeInstanceOf(V2BoardPreferencesUpdateError);
    }
  );

  it('fails closed on malformed success, unknown error, and timeout', async () => {
    const request = { remindTraffic: false };
    const malformed = new V2BoardAccountAdapter(
      client(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: false })))
    );
    const unknown = new V2BoardAccountAdapter(
      client(
        vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({ message: 'Unexpected update error' }, 500)
        )
      )
    );
    const timeout = new V2BoardAccountAdapter(
      client(
        vi
          .fn<typeof fetch>()
          .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
      )
    );
    await expect(
      malformed.updatePreferences('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      unknown.updatePreferences('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timeout.updatePreferences('opaque-token', request)
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });
});

describe('V2BoardAccountAdapter stats', () => {
  it.each([
    [[0, 0, 0], { pendingOrders: 0, openTickets: 0, invitedUsers: 0 }],
    [[2, 3, 4], { pendingOrders: 2, openTickets: 3, invitedUsers: 4 }],
  ] as const)('maps positional stats %# to named fields', async (data, expected) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data, internal: 'ignored' }));
    const adapter = new V2BoardAccountAdapter(client(fetcher));
    await expect(adapter.stats('opaque-token')).resolves.toEqual(expected);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/getStat');
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it.each([
    { data: [0, 0] },
    { data: [0, 0, 0, 0] },
    { data: [-1, 0, 0] },
    { data: [1.5, 0, 0] },
    { data: ['1', 0, 0] },
    { stats: [0, 0, 0] },
    { data: [2_147_483_648, 0, 0] },
  ])('fails closed on malformed stats %#', async (payload) => {
    const adapter = new V2BoardAccountAdapter(
      client(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload)))
    );
    await expect(adapter.stats('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes timeout', async () => {
    const adapter = new V2BoardAccountAdapter(
      client(
        vi
          .fn<typeof fetch>()
          .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
      )
    );
    await expect(adapter.stats('opaque-token')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });
});
