import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardTicketCloseError,
  V2BoardTicketCreateError,
  V2BoardTicketNotFoundError,
  V2BoardTicketReplyError,
  V2BoardTicketUnavailableError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardTicketsAdapter } from '../src/adapters/v2board/tickets';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardTicketsAdapter {
  return new V2BoardTicketsAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

function upstreamTicket(id = 7, level = 1, status = 0) {
  return {
    id,
    user_id: 99,
    subject: `Ticket ${id}`,
    level,
    status,
    reply_status: 1,
    created_at: 1704067200,
    updated_at: 1704153600,
    private_note: 'must-not-leak',
  };
}

describe('V2BoardTicketsAdapter list', () => {
  it('returns an empty list', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }))
    );

    await expect(adapter.tickets('opaque-token')).resolves.toEqual([]);
  });

  it('maps tickets, priorities, statuses, timestamps, and strips internals', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          upstreamTicket(7, 0, 0),
          upstreamTicket(8, 1, 1),
          upstreamTicket(9, 2, 0),
        ],
        internal: 'ignored',
      })
    );
    const adapter = createAdapter(fetcher);

    await expect(adapter.tickets('opaque-token')).resolves.toEqual([
      {
        id: '7',
        subject: 'Ticket 7',
        priority: 'low',
        status: 'open',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
      {
        id: '8',
        subject: 'Ticket 8',
        priority: 'normal',
        status: 'closed',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
      {
        id: '9',
        subject: 'Ticket 9',
        priority: 'high',
        status: 'open',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ]);

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/ticket/fetch');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it.each([
    ['missing subject', { ...upstreamTicket(), subject: undefined }],
    ['invalid id', { ...upstreamTicket(), id: '7' }],
    ['invalid status', upstreamTicket(7, 1, 2)],
    ['invalid level', upstreamTicket(7, 3, 0)],
    ['invalid timestamp', { ...upstreamTicket(), created_at: -1 }],
  ])('fails closed on %s', async (_case, ticket) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [ticket] }))
    );

    await expect(adapter.tickets('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes invalid JSON and timeout', async () => {
    const invalidJson = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{invalid', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );

    await expect(invalidJson.tickets('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(timeout.tickets('opaque-token')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });
});

describe('V2BoardTicketsAdapter detail', () => {
  it('maps messages and strips user, ticket, and staff fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          ...upstreamTicket(),
          message: [
            {
              id: 11,
              user_id: 99,
              ticket_id: 7,
              message: 'User message',
              is_me: true,
              created_at: 1704067200,
              updated_at: 1704067201,
            },
            {
              id: 12,
              user_id: 1,
              staff_id: 3,
              ticket_id: 7,
              message: 'Staff reply',
              is_me: false,
              created_at: 1704153600,
            },
          ],
        },
      })
    );
    const adapter = createAdapter(fetcher);

    await expect(adapter.ticket('opaque-token', '7')).resolves.toEqual({
      id: '7',
      subject: 'Ticket 7',
      priority: 'normal',
      status: 'open',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      messages: [
        {
          id: '11',
          content: 'User message',
          fromMe: true,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: '12',
          content: 'Staff reply',
          fromMe: false,
          createdAt: '2024-01-02T00:00:00.000Z',
        },
      ],
    });

    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/ticket/fetch?id=7'
    );
  });

  it.each([
    ['missing messages', upstreamTicket()],
    [
      'invalid direction',
      { ...upstreamTicket(), message: [{ id: 1, message: 'x', is_me: 1, created_at: 1 }] },
    ],
    [
      'invalid message id',
      { ...upstreamTicket(), message: [{ id: -1, message: 'x', is_me: true, created_at: 1 }] },
    ],
  ])('fails closed on %s', async (_case, ticket) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: ticket }))
    );

    await expect(adapter.ticket('opaque-token', '7')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('maps an upstream 404 to ticket not found', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'Not Found' }, 404))
    );

    await expect(adapter.ticket('opaque-token', '7')).rejects.toBeInstanceOf(
      V2BoardTicketNotFoundError
    );
  });
});

describe('V2BoardTicketsAdapter mutations', () => {
  it.each([
    ['low', 0],
    ['normal', 1],
    ['high', 2],
  ] as const)('maps create priority %s to level %s', async (priority, level) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true, internal: 'ignored' }));
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.createTicket('opaque-token', {
        subject: 'Connection issue',
        priority,
        message: 'Please investigate.',
      })
    ).resolves.toEqual({ created: true });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      subject: 'Connection issue',
      level,
      message: 'Please investigate.',
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/ticket/save'
    );
  });

  it.each([
    'There are other unresolved tickets',
    '存在其它工单尚未处理',
    '请先购买套餐',
    '当前套餐不允许发起工单',
  ])('maps exact create unavailability: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );
    await expect(
      adapter.createTicket('opaque-token', {
        subject: 'Subject',
        priority: 'normal',
        message: 'Message',
      })
    ).rejects.toBeInstanceOf(V2BoardTicketUnavailableError);
  });

  it('maps an exact create failure and rejects partial message matches', async () => {
    const known = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Ticket subject cannot be empty' }, 500)
      )
    );
    const partial = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Ticket subject cannot be empty: SQL error' }, 500)
      )
    );
    const request = { subject: 'Subject', priority: 'normal' as const, message: 'Message' };

    await expect(known.createTicket('opaque-token', request)).rejects.toBeInstanceOf(
      V2BoardTicketCreateError
    );
    await expect(partial.createTicket('opaque-token', request)).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('preserves timeout errors while creating a ticket', async () => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );

    await expect(
      adapter.createTicket('opaque-token', {
        subject: 'Subject',
        priority: 'normal',
        message: 'Message',
      })
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });

  it('maps reply request and success', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: true }));
    const adapter = createAdapter(fetcher);

    await expect(
      adapter.replyTicket('opaque-token', '7', { message: 'Reply text' })
    ).resolves.toEqual({ replied: true });
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/ticket/reply'
    );
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      id: 7,
      message: 'Reply text',
    });
  });

  it.each(['Ticket does not exist', '工单不存在'])(
    'maps exact missing ticket for reply and close: %s',
    async (message) => {
      const reply = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
      );
      const close = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
      );

      await expect(
        reply.replyTicket('opaque-token', '7', { message: 'Reply' })
      ).rejects.toBeInstanceOf(V2BoardTicketNotFoundError);
      await expect(close.closeTicket('opaque-token', '7')).rejects.toBeInstanceOf(
        V2BoardTicketNotFoundError
      );
    }
  );

  it.each([
    'The ticket is closed and cannot be replied',
    '工单已关闭，无法回复',
    'Please wait for the technical enginneer to reply',
    '请等待技术支持回复',
    'Ticket reply failed',
    '工单回复失败',
  ])('maps exact reply failure: %s', async (message) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
    );

    await expect(
      adapter.replyTicket('opaque-token', '7', { message: 'Reply' })
    ).rejects.toBeInstanceOf(V2BoardTicketReplyError);
  });

  it('preserves timeout errors while replying to a ticket', async () => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );

    await expect(
      adapter.replyTicket('opaque-token', '7', { message: 'Reply' })
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });

  it('maps close request, success, and exact failure', async () => {
    const successFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true }));
    const success = createAdapter(successFetch);
    const failure = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'Close failed' }, 500))
    );

    await expect(success.closeTicket('opaque-token', '7')).resolves.toEqual({
      closed: true,
    });
    expect(successFetch.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/ticket/close'
    );
    expect(JSON.parse(String(successFetch.mock.calls[0][1]?.body))).toEqual({ id: 7 });
    await expect(failure.closeTicket('opaque-token', '7')).rejects.toBeInstanceOf(
      V2BoardTicketCloseError
    );
  });

  it('fails closed on malformed successes, unknown errors, and timeout', async () => {
    const malformed = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: 1 }))
    );
    const unknown = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'SQL failure with private details' }, 500)
      )
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );

    await expect(malformed.closeTicket('opaque-token', '7')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(
      unknown.replyTicket('opaque-token', '7', { message: 'Reply' })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(timeout.closeTicket('opaque-token', '7')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });
});
