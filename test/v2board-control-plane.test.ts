import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ControlPlaneError,
  ControlPlaneErrorCode,
  V2BoardControlPlaneClient,
  createV2BoardControlPlaneClient,
} from '../src/adapters/v2board/control-plane';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const env = {
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
  V2BOARD_CONTROL_AUTH_DATA: 'AUTH_DATA_SENTINEL',
  V2BOARD_CONTROL_ADMIN_PREFIX: 'secure-admin_123',
  V2BOARD_ACCESS_CLIENT_ID: 'access-id',
  V2BOARD_ACCESS_CLIENT_SECRET: 'access-secret',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('V2BoardControlPlaneClient surface and source acquisition', () => {
  it('exposes only the code-owned Registry Knowledge source operation', () => {
    expect(
      Object.getOwnPropertyNames(V2BoardControlPlaneClient.prototype).sort()
    ).toEqual(['constructor', 'readRegistryKnowledgeSource']);
  });

  it('does not serialize bootstrap auth, prefix, origin, or transport state', () => {
    const client = createV2BoardControlPlaneClient(env, vi.fn<typeof fetch>());
    const serialized = JSON.stringify(client);
    for (const sentinel of [
      'AUTH_DATA_SENTINEL',
      'secure-admin_123',
      'backend.example',
      'access-secret',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('lists first, fetches detail only for active reserved records, and projects raw payloads', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              title: 'Ordinary help',
              category: 'Help',
              show: 1,
              updated_at: 1704067200,
              unexpected: 'discard-me',
            },
            {
              id: 2,
              title: 'registry:module-a',
              category: '__AUREOLE_REGISTRY__',
              show: 1,
              updated_at: 1704153600,
            },
            {
              id: 3,
              title: 'registry:hidden-module',
              category: '__AUREOLE_REGISTRY__',
              show: 0,
              updated_at: 1704240000,
            },
          ],
          raw: 'RAW_BODY_SECRET_SENTINEL',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 2,
            title: 'registry:module-a',
            category: '__AUREOLE_REGISTRY__',
            show: 1,
            updated_at: 1704153600,
            body: '{"kind":"aureole.registry"}',
            secret_internal_field: 'RAW_BODY_SECRET_SENTINEL',
          },
        })
      );

    const source = await createV2BoardControlPlaneClient(env, fetcher)
      .readRegistryKnowledgeSource();

    expect(source).toEqual([
      {
        sourceId: 2,
        title: 'registry:module-a',
        category: '__AUREOLE_REGISTRY__',
        show: 1,
        updatedAt: 1704153600,
        body: '{"kind":"aureole.registry"}',
      },
      {
        sourceId: 3,
        title: 'registry:hidden-module',
        category: '__AUREOLE_REGISTRY__',
        show: 0,
        updatedAt: 1704240000,
      },
    ]);
    expect(JSON.stringify(source)).not.toContain('RAW_BODY_SECRET_SENTINEL');
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://backend.example/api/v1/secure-admin_123/knowledge/fetch',
      'https://backend.example/api/v1/secure-admin_123/knowledge/fetch?id=2',
    ]);
    for (const [, init] of fetcher.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(init?.redirect).toBe('manual');
      expect(headers.get('authorization')).toBe('AUTH_DATA_SENTINEL');
      expect(headers.get('cf-access-client-id')).toBe('access-id');
      expect(headers.get('cf-access-client-secret')).toBe('access-secret');
    }
  });

  it('rejects a detail that no longer agrees with the code-selected list record', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{
            id: 2,
            title: 'registry:module-a',
            category: '__AUREOLE_REGISTRY__',
            show: 1,
            updated_at: 1,
          }],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 999,
            title: 'registry:module-a',
            category: '__AUREOLE_REGISTRY__',
            show: 1,
            updated_at: 1,
            body: '{}',
          },
        })
      );

    await expect(
      createV2BoardControlPlaneClient(env, fetcher)
        .readRegistryKnowledgeSource()
    ).rejects.toMatchObject({
      code: ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR,
    });
  });
});

describe('Control Plane Admin prefix validation', () => {
  it.each([
    'secure-admin',
    'secure_admin-123',
    'admin.abc',
    'secure.admin_123',
    'admin-v2.example',
    'segment-one/segment-two',
    'nested.admin/path.v2',
  ])(
    'allows safe deployment prefix %s',
    async (prefix) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ data: [] }));
      await createV2BoardControlPlaneClient(
        { ...env, V2BOARD_CONTROL_ADMIN_PREFIX: prefix },
        fetcher
      ).readRegistryKnowledgeSource();
      expect(String(fetcher.mock.calls[0][0])).toBe(
        `https://backend.example/api/v1/${prefix}/knowledge/fetch`
      );
    }
  );

  it.each([
    'https://attacker.example/admin',
    'http:evil',
    'javascript:evil',
    '/absolute',
    '\\absolute',
    'javascript:admin',
    'admin?x=1',
    'admin#fragment',
    '.',
    '..',
    'admin/../other',
    'admin/./child',
    'admin/%2e%2e/other',
    'admin//other',
    'admin%2fother',
    'a'.repeat(129),
  ])('rejects unsafe prefix %s before fetch', async (prefix) => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() =>
      createV2BoardControlPlaneClient(
        { ...env, V2BOARD_CONTROL_ADMIN_PREFIX: prefix },
        fetcher
      )
    ).toThrowError(ControlPlaneError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Control Plane normalized errors and redaction', () => {
  it.each([undefined, '', '   ', 'bad\r\nheader', 'x'.repeat(8193)])(
    'normalizes missing/empty bootstrap auth %#',
    (authData) => {
      expect(() =>
        createV2BoardControlPlaneClient({
          ...env,
          V2BOARD_CONTROL_AUTH_DATA: authData,
        })
      ).toThrowError(
        expect.objectContaining({
          code: ControlPlaneErrorCode.CONTROL_PLANE_AUTH_INVALID,
        })
      );
    }
  );

  it.each([undefined, '', 'bad?query'])('normalizes invalid prefix %#', (prefix) => {
    expect(() =>
      createV2BoardControlPlaneClient({
        ...env,
        V2BOARD_CONTROL_ADMIN_PREFIX: prefix,
      })
    ).toThrowError(
      expect.objectContaining({
        code: ControlPlaneErrorCode.CONTROL_PLANE_CONFIG_INVALID,
      })
    );
  });

  it.each([401, 403])('maps Admin HTTP %s to auth invalid', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'AUTH_DATA_SENTINEL' }, status));
    const client = createV2BoardControlPlaneClient(
      env,
      fetcher
    );
    await expect(client.readRegistryKnowledgeSource()).rejects.toMatchObject({
      code: ControlPlaneErrorCode.CONTROL_PLANE_AUTH_INVALID,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'https://backend.example/api/v1/secure-admin_123/knowledge/fetch'
    );
  });

  it.each([
    [
      '500 JSON',
      jsonResponse(
        {
          message:
            'RAW_BODY_SECRET_SENTINEL COUPON_SENTINEL SUB_TOKEN_SENTINEL',
        },
        500
      ),
    ],
    [
      'HTML',
      new Response(
        '<h1>RAW_BODY_SECRET_SENTINEL COUPON_SENTINEL SUB_TOKEN_SENTINEL</h1>',
        { status: 500 }
      ),
    ],
    [
      'invalid JSON',
      new Response(
        '{RAW_BODY_SECRET_SENTINEL COUPON_SENTINEL SUB_TOKEN_SENTINEL',
        { status: 200 }
      ),
    ],
    [
      'malformed envelope',
      jsonResponse({
        data: 'RAW_BODY_SECRET_SENTINEL COUPON_SENTINEL SUB_TOKEN_SENTINEL',
      }),
    ],
  ])('maps %s to safe upstream error', async (_case, response) => {
    const client = createV2BoardControlPlaneClient(
      env,
      vi.fn<typeof fetch>().mockResolvedValue(response)
    );
    let thrown: unknown;
    try {
      await client.readRegistryKnowledgeSource();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR,
    });
    const serialized = `${(thrown as Error).message} ${JSON.stringify(thrown)}`;
    for (const sentinel of [
      'RAW_BODY_SECRET_SENTINEL',
      'COUPON_SENTINEL',
      'SUB_TOKEN_SENTINEL',
      'AUTH_DATA_SENTINEL',
      'secure-admin_123',
      'backend.example',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('maps timeout and emits no credential/raw-body console output', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const client = createV2BoardControlPlaneClient(
      env,
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(
          new DOMException(
            'AUTH_DATA_SENTINEL RAW_BODY_SECRET_SENTINEL COUPON_SENTINEL SUB_TOKEN_SENTINEL',
            'TimeoutError'
          )
        )
    );

    await expect(client.readRegistryKnowledgeSource()).rejects.toMatchObject({
      code: ControlPlaneErrorCode.CONTROL_PLANE_TIMEOUT,
    });
    const output = JSON.stringify([...error.mock.calls, ...log.mock.calls]);
    for (const sentinel of [
      'AUTH_DATA_SENTINEL',
      'RAW_BODY_SECRET_SENTINEL',
      'COUPON_SENTINEL',
      'SUB_TOKEN_SENTINEL',
      'secure-admin_123',
      'backend.example',
    ]) {
      expect(output).not.toContain(sentinel);
    }
  });
});
