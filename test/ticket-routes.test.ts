import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';

const env = {
  V2BOARD_BASE_URL: 'https://backend.example/api/v1/',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authorizedJson(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: {
      Authorization: 'Bearer opaque-token',
      'Content-Type': 'application/json',
      'cf-ray': 'request-id',
    },
    body: JSON.stringify(body),
  };
}

function upstreamTicket() {
  return {
    id: 7,
    user_id: 99,
    subject: 'Connection issue',
    level: 1,
    status: 0,
    reply_status: 0,
    created_at: 1704067200,
    updated_at: 1704153600,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ticket read routes', () => {
  it('returns a minimal ticket list with no-store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [upstreamTicket()] }))
    );

    const response = await app.request(
      '/api/v1/tickets',
      { headers: { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' } },
      env
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        tickets: [
          {
            id: '7',
            subject: 'Connection issue',
            priority: 'normal',
            status: 'open',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
      },
      requestId: 'request-id',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('returns a minimal ticket detail and strips all ownership fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: {
            ...upstreamTicket(),
            message: [
              {
                id: 11,
                user_id: 99,
                staff_id: 1,
                ticket_id: 7,
                message: 'Sensitive user content',
                is_me: true,
                created_at: 1704067200,
              },
            ],
          },
        })
      )
    );

    const response = await app.request(
      '/api/v1/tickets/7',
      { headers: { Authorization: 'Bearer opaque-token', 'cf-ray': 'request-id' } },
      env
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        id: '7',
        subject: 'Connection issue',
        priority: 'normal',
        status: 'open',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        messages: [
          {
            id: '11',
            content: 'Sensitive user content',
            fromMe: true,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
      requestId: 'request-id',
    });
    expect(JSON.stringify(body)).not.toContain('user_id');
    expect(JSON.stringify(body)).not.toContain('ticket_id');
    expect(JSON.stringify(body)).not.toContain('staff_id');
  });

  it.each(['/api/v1/tickets', '/api/v1/tickets/7'])(
    'requires shared authorization for %s',
    async (path) => {
      const fetcher = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetcher);
      const response = await app.request(path, undefined, env);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it.each(['0', '-1', '1.5', 'abc', '2147483648'])(
    'rejects invalid ticket id %s before upstream',
    async (id) => {
      const fetcher = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetcher);
      const response = await app.request(
        `/api/v1/tickets/${encodeURIComponent(id)}`,
        { headers: { Authorization: 'Bearer opaque-token' } },
        env
      );
      expect(response.status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it('normalizes authentication, not found, malformed data, and timeout', async () => {
    const cases = [
      [jsonResponse({ message: 'Session expired' }, 403), 401, 'AUTH_FAILED'],
      [jsonResponse({ message: 'Not Found' }, 404), 404, 'TICKET_NOT_FOUND'],
      [jsonResponse({ data: { ...upstreamTicket(), message: 'bad' } }), 502, 'UPSTREAM_ERROR'],
    ] as const;
    for (const [upstream, status, code] of cases) {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(upstream));
      const response = await app.request(
        '/api/v1/tickets/7',
        { headers: { Authorization: 'Bearer opaque-token' } },
        env
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const timeout = await app.request(
      '/api/v1/tickets/7',
      { headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(timeout.status).toBe(504);
  });
});

describe('ticket mutation routes', () => {
  it('creates a ticket using only the mapped public fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: true }));
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/tickets',
      authorizedJson('POST', {
        subject: 'Connection issue',
        priority: 'high',
        message: 'Please investigate.',
      }),
      env
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      data: { created: true },
      requestId: 'request-id',
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      subject: 'Connection issue',
      level: 2,
      message: 'Please investigate.',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['missing subject', { priority: 'normal', message: 'Message' }],
    ['empty subject', { subject: '', priority: 'normal', message: 'Message' }],
    ['long subject', { subject: 's'.repeat(256), priority: 'normal', message: 'Message' }],
    ['invalid priority', { subject: 'Subject', priority: 'urgent', message: 'Message' }],
    ['missing message', { subject: 'Subject', priority: 'normal' }],
    ['empty message', { subject: 'Subject', priority: 'normal', message: '' }],
    ['long message', { subject: 'Subject', priority: 'normal', message: 'm'.repeat(10_001) }],
    [
      'extra upstream field',
      { subject: 'Subject', priority: 'normal', message: 'Message', level: 2 },
    ],
  ])('rejects create %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/tickets',
      authorizedJson('POST', body),
      env
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('replies and closes using the public ticket id', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: true }))
      .mockResolvedValueOnce(jsonResponse({ data: true }));
    vi.stubGlobal('fetch', fetcher);

    const reply = await app.request(
      '/api/v1/tickets/7/reply',
      authorizedJson('POST', { message: 'Reply text' }),
      env
    );
    const close = await app.request(
      '/api/v1/tickets/7/close',
      { method: 'POST', headers: { Authorization: 'Bearer opaque-token' } },
      env
    );

    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ data: { replied: true } });
    expect(close.status).toBe(200);
    expect(await close.json()).toMatchObject({ data: { closed: true } });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      id: 7,
      message: 'Reply text',
    });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ id: 7 });
  });

  it.each([
    ['missing message', {}],
    ['empty message', { message: '' }],
    ['long message', { message: 'm'.repeat(10_001) }],
    ['extra field', { message: 'Reply', ticket_id: 7 }],
  ])('rejects reply %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/tickets/7/reply',
      authorizedJson('POST', body),
      env
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['There are other unresolved tickets', 409, 'TICKET_UNAVAILABLE'],
    ['Ticket subject cannot be empty', 502, 'TICKET_CREATE_FAILED'],
  ] as const)('normalizes create error %s', async (message, status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    const response = await app.request(
      '/api/v1/tickets',
      authorizedJson('POST', {
        subject: 'Subject',
        priority: 'normal',
        message: 'Message',
      }),
      env
    );
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).toContain(code);
    expect(text).not.toContain(message);
  });

  it.each([
    ['/api/v1/tickets/7/reply', { message: 'Reply' }, 'Ticket does not exist', 404, 'TICKET_NOT_FOUND'],
    ['/api/v1/tickets/7/reply', { message: 'Reply' }, 'The ticket is closed and cannot be replied', 409, 'TICKET_REPLY_FAILED'],
    ['/api/v1/tickets/7/close', undefined, 'Close failed', 502, 'TICKET_CLOSE_FAILED'],
  ] as const)('normalizes mutation failure for %s', async (path, body, message, status, code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    const init = body === undefined
      ? { method: 'POST', headers: { Authorization: 'Bearer opaque-token' } }
      : authorizedJson('POST', body);
    const response = await app.request(path, init, env);
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(text).toContain(code);
    expect(text).not.toContain(message);
  });

  it('requires authentication before reading mutation bodies', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request(
      '/api/v1/tickets/7/reply',
      { method: 'POST', body: '{invalid' },
      env
    );
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normalizes timeout and does not log ticket content or upstream details', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    const timeout = await app.request(
      '/api/v1/tickets/7/close',
      { method: 'POST', headers: { Authorization: 'Bearer opaque-token' } },
      env
    );
    expect(timeout.status).toBe(504);

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<h1>private Laravel failure</h1>', { status: 500 })
      )
    );
    await app.request(
      '/api/v1/tickets',
      authorizedJson('POST', {
        subject: 'sensitive subject',
        priority: 'normal',
        message: 'sensitive message',
      }),
      env
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain('sensitive subject');
    expect(logged).not.toContain('sensitive message');
    expect(logged).not.toContain('opaque-token');
    expect(logged).not.toContain('private Laravel failure');
    expect(logged).not.toContain('backend.example');
  });
});
