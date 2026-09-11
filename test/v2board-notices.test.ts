import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardNoticeNotFoundError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardNoticesAdapter } from '../src/adapters/v2board/notices';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardNoticesAdapter {
  return new V2BoardNoticesAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

function upstreamNotice(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    title: 'Maintenance notice',
    content: '<p>Scheduled maintenance</p>',
    show: 1,
    img_url: 'https://private.example/banner.png',
    tags: ['maintenance'],
    created_at: 1704067200,
    updated_at: 1704153600,
    internal_flag: 'must-not-leak',
    ...overrides,
  };
}

describe('V2BoardNoticesAdapter list', () => {
  it('maps pagination and returns an empty page', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: [], total: 0 }));
    const adapter = createAdapter(fetcher);

    await expect(adapter.notices('opaque-token', { page: 2, pageSize: 20 })).resolves.toEqual({
      items: [],
      page: 2,
      pageSize: 20,
      total: 0,
    });

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://backend.example/api/v1/user/notice/fetch?current=2&pageSize=20'
    );
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it('maps multiple notices, normalizes null tags, and strips content and internals', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          data: [
            upstreamNotice(),
            upstreamNotice({
              id: 8,
              title: 'General notice',
              tags: null,
              created_at: 1704240000,
              updated_at: 1704326400,
            }),
          ],
          total: 2,
        })
      )
    );

    await expect(adapter.notices('opaque-token', { page: 1, pageSize: 100 })).resolves.toEqual({
      items: [
        {
          id: '7',
          title: 'Maintenance notice',
          tags: ['maintenance'],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        {
          id: '8',
          title: 'General notice',
          tags: [],
          createdAt: '2024-01-03T00:00:00.000Z',
          updatedAt: '2024-01-04T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 100,
      total: 2,
    });
  });

  it.each([
    ['missing title', { ...upstreamNotice(), title: undefined }],
    ['missing content', { ...upstreamNotice(), content: undefined }],
    ['string id', upstreamNotice({ id: '7' })],
    ['non-string tag', upstreamNotice({ tags: ['ok', 2] })],
    ['too many tags', upstreamNotice({ tags: Array.from({ length: 256 }, () => 'tag') })],
    ['negative timestamp', upstreamNotice({ created_at: -1 })],
    ['string timestamp', upstreamNotice({ updated_at: '1704153600' })],
  ])('fails closed on malformed list item: %s', async (_case, notice) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: [notice], total: 1 })
      )
    );

    await expect(
      adapter.notices('opaque-token', { page: 1, pageSize: 20 })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])(
    'fails closed on malformed total %s',
    async (total) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [], total }))
      );
      await expect(
        adapter.notices('opaque-token', { page: 1, pageSize: 20 })
      ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    }
  );

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

    await expect(
      invalidJson.notices('opaque-token', { page: 1, pageSize: 20 })
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timeout.notices('opaque-token', { page: 1, pageSize: 20 })
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });
});

describe('V2BoardNoticesAdapter detail', () => {
  it('returns HTML-capable content as an opaque string and strips internal fields', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: upstreamNotice() }));
    const adapter = createAdapter(fetcher);

    await expect(adapter.notice('opaque-token', '7')).resolves.toEqual({
      id: '7',
      title: 'Maintenance notice',
      content: '<p>Scheduled maintenance</p>',
      tags: ['maintenance'],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://backend.example/api/v1/user/notice/fetch?id=7'
    );
  });

  it('normalizes null tags to an empty array', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: upstreamNotice({ tags: null }) })
      )
    );
    await expect(adapter.notice('opaque-token', '7')).resolves.toMatchObject({ tags: [] });
  });

  it.each([
    ['non-string content', upstreamNotice({ content: { html: '<p>x</p>' } })],
    ['oversized content', upstreamNotice({ content: 'x'.repeat(65_536) })],
    ['malformed tags', upstreamNotice({ tags: 'maintenance' })],
    ['malformed timestamp', upstreamNotice({ updated_at: null })],
  ])('fails closed on malformed detail: %s', async (_case, notice) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: notice }))
    );
    await expect(adapter.notice('opaque-token', '7')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('maps the official HTTP 404 to NOTICE_NOT_FOUND', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Notice not found' }, 404)
      )
    );
    await expect(adapter.notice('opaque-token', '999')).rejects.toBeInstanceOf(
      V2BoardNoticeNotFoundError
    );
  });

  it('preserves timeout errors for detail', async () => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    await expect(adapter.notice('opaque-token', '7')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });
});
