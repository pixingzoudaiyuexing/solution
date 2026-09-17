import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardAuthenticationError,
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
    img_url: null,
    tags: ['maintenance'],
    created_at: 1704067200,
    updated_at: 1704153600,
    internal_flag: 'must-not-leak',
    ...overrides,
  };
}

function onePage(notice: unknown): typeof fetch {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse({ data: [notice], total: 1 }));
}

async function classify(tags: unknown) {
  const notice = upstreamNotice({
    title: ' Custom page ',
    content: ' https://custom.example/docs ',
    tags,
  });
  const customPages = await createAdapter(onePage(notice)).customPages(
    'opaque-token'
  );
  const notices = await createAdapter(onePage(notice)).notices('opaque-token', {
    page: 1,
    pageSize: 20,
  });
  return { customPages, notices };
}

describe('V2BoardNoticesAdapter CF-03B namespace classification', () => {
  it.each([
    ['null tags', null],
    ['empty tags', []],
    ['ordinary tags', ['help', 'tutorial']],
    ['substring only', ['help-aureole:iframe']],
    ['title-case namespace', ['Aureole:iframe']],
    ['uppercase namespace', ['AUREOLE:iframe']],
  ])('keeps %s ordinary', async (_case, tags) => {
    const result = await classify(tags);

    expect(result.customPages).toEqual([]);
    expect(result.notices.total).toBe(1);
    expect(result.notices.items).toHaveLength(1);
  });

  it.each([
    ['iframe', ['aureole:iframe'], 'iframe'],
    ['external', ['aureole:external'], 'external'],
    ['ordinary tag plus iframe', ['help', 'aureole:iframe'], 'iframe'],
  ])('maps exact lowercase %s and hides it from notices', async (_case, tags, mode) => {
    const result = await classify(tags);

    expect(result.customPages).toEqual([
      {
        id: 'notice-7',
        title: 'Custom page',
        url: 'https://custom.example/docs',
        mode,
      },
    ]);
    expect(result.notices).toMatchObject({ items: [], total: 0 });
  });

  it.each([
    ['unknown reserved mode', ['aureole:unknown']],
    ['both modes', ['aureole:iframe', 'aureole:external']],
    ['valid plus unknown', ['aureole:iframe', 'aureole:whatever']],
    ['duplicate reserved mode', ['aureole:iframe', 'aureole:iframe']],
  ])('fails closed per item for %s', async (_case, tags) => {
    const result = await classify(tags);

    expect(result.customPages).toEqual([]);
    expect(result.notices).toMatchObject({ items: [], total: 0 });
  });
});

describe('V2BoardNoticesAdapter CF-03B valid custom pages', () => {
  it.each([
    ['iframe root', 'aureole:iframe', ' https://docs.example.com ', 'iframe'],
    [
      'external path',
      'aureole:external',
      'https://docs.example.com/path',
      'external',
    ],
    [
      'custom port',
      'aureole:iframe',
      'https://docs.example.com:8443/docs',
      'iframe',
    ],
    [
      'query and fragment',
      'aureole:external',
      'https://docs.example.com/docs?a=1#intro',
      'external',
    ],
    [
      'trailing slash',
      'aureole:iframe',
      'https://docs.example.com/',
      'iframe',
    ],
  ])('preserves configured URL representation for %s', async (_case, tag, content, mode) => {
    const adapter = createAdapter(
      onePage(
        upstreamNotice({
          id: 42,
          title: '  Documentation  ',
          content,
          tags: [tag],
        })
      )
    );

    await expect(adapter.customPages('opaque-token')).resolves.toEqual([
      {
        id: 'notice-42',
        title: 'Documentation',
        url: content.trim(),
        mode,
      },
    ]);
  });

  it('preserves upstream relative ordering and exposes only the four public fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          upstreamNotice({
            id: 9,
            title: ' First ',
            content: 'https://first.example/path?x=1#top',
            tags: ['aureole:external', 'ordinary'],
          }),
          upstreamNotice({ id: 8, title: 'Ordinary', tags: ['help'] }),
          upstreamNotice({
            id: 7,
            title: ' Second ',
            content: 'https://second.example/',
            tags: ['aureole:iframe'],
          }),
        ],
        total: 3,
      })
    );

    const pages = await createAdapter(fetcher).customPages('opaque-token');

    expect(pages).toEqual([
      {
        id: 'notice-9',
        title: 'First',
        url: 'https://first.example/path?x=1#top',
        mode: 'external',
      },
      {
        id: 'notice-7',
        title: 'Second',
        url: 'https://second.example/',
        mode: 'iframe',
      },
    ]);
    expect(Object.keys(pages[0])).toEqual(['id', 'title', 'url', 'mode']);
  });
});

describe('V2BoardNoticesAdapter CF-03B invalid reserved config', () => {
  it.each([
    ['blank title', { title: '' }],
    ['whitespace title', { title: '   ' }],
    ['http URL', { content: 'http://docs.example.com' }],
    ['relative URL', { content: '/docs' }],
    ['malformed URL', { content: 'https://' }],
    ['javascript URL', { content: 'javascript:alert(1)' }],
    ['data URL', { content: 'data:text/html,test' }],
    ['file URL', { content: 'file:///etc/passwd' }],
    ['blob URL', { content: 'blob:https://docs.example.com/id' }],
    ['username', { content: 'https://user@docs.example.com' }],
    ['password', { content: 'https://user:pass@docs.example.com' }],
    ['unknown mode', { tags: ['aureole:unknown'] }],
    ['both modes', { tags: ['aureole:iframe', 'aureole:external'] }],
    [
      'valid plus unknown',
      { tags: ['ordinary', 'aureole:external', 'aureole:future'] },
    ],
  ])('hides %s from every public notice surface', async (_case, overrides) => {
    const notice = upstreamNotice({
      title: 'Custom page',
      content: 'https://docs.example.com',
      tags: ['aureole:iframe'],
      ...overrides,
    });

    await expect(
      createAdapter(onePage(notice)).customPages('opaque-token')
    ).resolves.toEqual([]);
    await expect(
      createAdapter(onePage(notice)).notices('opaque-token', {
        page: 1,
        pageSize: 20,
      })
    ).resolves.toMatchObject({ items: [], total: 0 });
    await expect(
      createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: notice }))
      ).notice('opaque-token', '7')
    ).rejects.toBeInstanceOf(V2BoardNoticeNotFoundError);
  });

  it('continues past one invalid reserved item and returns other valid pages', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          upstreamNotice({
            id: 3,
            title: 'Invalid',
            content: 'https://invalid.example',
            tags: ['aureole:iframe', 'aureole:external'],
          }),
          upstreamNotice({
            id: 2,
            title: 'Valid',
            content: 'https://valid.example',
            tags: ['aureole:external'],
          }),
          upstreamNotice({ id: 1, title: 'Ordinary', tags: [] }),
        ],
        total: 3,
      })
    );

    await expect(
      createAdapter(fetcher).customPages('opaque-token')
    ).resolves.toEqual([
      {
        id: 'notice-2',
        title: 'Valid',
        url: 'https://valid.example',
        mode: 'external',
      },
    ]);
  });
});

describe('V2BoardNoticesAdapter CF-03B ordinary notice pagination', () => {
  const mixed = [
    upstreamNotice({ id: 5, title: 'Normal 5', tags: ['news'] }),
    upstreamNotice({ id: 4, title: 'Reserved 4', tags: ['aureole:unknown'] }),
    upstreamNotice({ id: 3, title: 'Normal 3', tags: null }),
    upstreamNotice({
      id: 2,
      title: 'Reserved 2',
      content: 'https://custom.example',
      tags: ['aureole:iframe'],
    }),
    upstreamNotice({ id: 1, title: 'Normal 1', tags: [] }),
  ];

  it.each([
    [1, 2, ['5', '3']],
    [2, 2, ['1']],
    [3, 2, []],
  ])('repaginates page %s with size %s after filtering', async (page, pageSize, ids) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data: mixed, total: mixed.length })
      )
    );

    const result = await adapter.notices('opaque-token', { page, pageSize });

    expect(result.items.map((item) => item.id)).toEqual(ids);
    expect(result).toMatchObject({ page, pageSize, total: 3 });
  });

  it('returns zero ordinary notices when the collection is custom-only', async () => {
    const data = [
      upstreamNotice({ id: 2, tags: ['aureole:unknown'] }),
      upstreamNotice({
        id: 1,
        content: 'https://custom.example',
        tags: ['aureole:iframe'],
      }),
    ];
    const result = await createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ data, total: data.length })
      )
    ).notices('opaque-token', { page: 1, pageSize: 20 });

    expect(result).toMatchObject({ items: [], total: 0 });
  });
});

describe('V2BoardNoticesAdapter CF-03B complete collection', () => {
  function pagedFetcher(pageOne: unknown[], pageTwo: unknown[], totals = [102, 102]) {
    return vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      const current = Number(url.searchParams.get('current'));
      if (current === 1) {
        return jsonResponse({ data: pageOne, total: totals[0] });
      }
      if (current === 2) {
        return jsonResponse({ data: pageTwo, total: totals[1] });
      }
      return jsonResponse({ data: [], total: totals[1] });
    });
  }

  const firstHundred = Array.from({ length: 100 }, (_, index) =>
    upstreamNotice({ id: index + 1, title: `Notice ${index + 1}` })
  );

  it('collects beyond 100 without truncation and classifies later records', async () => {
    const secondPage = [
      upstreamNotice({
        id: 101,
        title: 'Later custom',
        content: 'https://later.example/docs',
        tags: ['aureole:iframe'],
      }),
      upstreamNotice({ id: 102, title: 'Later ordinary', tags: [] }),
    ];
    const customFetcher = pagedFetcher(firstHundred, secondPage);
    const noticeFetcher = pagedFetcher(firstHundred, secondPage);

    await expect(
      createAdapter(customFetcher).customPages('opaque-token')
    ).resolves.toEqual([
      {
        id: 'notice-101',
        title: 'Later custom',
        url: 'https://later.example/docs',
        mode: 'iframe',
      },
    ]);
    const notices = await createAdapter(noticeFetcher).notices('opaque-token', {
      page: 6,
      pageSize: 20,
    });
    expect(notices.items.map((item) => item.id)).toEqual(['102']);
    expect(notices.total).toBe(101);

    for (const fetcher of [customFetcher, noticeFetcher]) {
      expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
        'https://backend.example/api/v1/user/notice/fetch?current=1&pageSize=100',
        'https://backend.example/api/v1/user/notice/fetch?current=2&pageSize=100',
      ]);
      expect(
        fetcher.mock.calls.some(([url]) => String(url).includes('later.example'))
      ).toBe(false);
    }
  });

  it.each([
    [
      'short non-final page',
      pagedFetcher(firstHundred.slice(0, 99), [upstreamNotice({ id: 101 })], [101, 101]),
    ],
    [
      'no progress',
      pagedFetcher(firstHundred, [], [101, 101]),
    ],
    [
      'total changes',
      pagedFetcher(firstHundred, [upstreamNotice({ id: 101 })], [101, 102]),
    ],
    [
      'duplicate id',
      pagedFetcher(firstHundred, [upstreamNotice({ id: 100 })], [101, 101]),
    ],
  ])('fails closed on inconsistent pagination: %s', async (_case, fetcher) => {
    await expect(
      createAdapter(fetcher).customPages('opaque-token')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });
});

describe('V2BoardNoticesAdapter CF-03B structural and upstream failures', () => {
  it.each([
    ['tags string', { tags: 'bad' }],
    ['invalid id', { id: '7' }],
    ['invalid title type', { title: 7 }],
    ['invalid content type', { content: { url: 'https://docs.example' } }],
  ])('fails closed instead of skipping structural corruption: %s', async (_case, overrides) => {
    await expect(
      createAdapter(onePage(upstreamNotice(overrides))).customPages(
        'opaque-token'
      )
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([
    ['empty ordinary title', { title: '', tags: [] }],
    ['empty ordinary content', { content: '', tags: [] }],
  ])('preserves existing structural failure for %s', async (_case, overrides) => {
    await expect(
      createAdapter(onePage(upstreamNotice(overrides))).customPages(
        'opaque-token'
      )
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it.each([401, 403])('preserves authentication failure for HTTP %s', async (status) => {
    const adapter = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ message: 'private' }, status))
    );
    await expect(adapter.customPages('opaque-token')).rejects.toBeInstanceOf(
      V2BoardAuthenticationError
    );
  });

  it('normalizes 500, malformed envelope, invalid JSON, network failure, and timeout', async () => {
    const upstream500 = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'SQL' }, 500))
    );
    const malformedEnvelope = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }))
    );
    const invalidJson = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('{', { status: 200 }))
    );
    const network = createAdapter(
      vi.fn<typeof fetch>().mockRejectedValue(new Error('network failure'))
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );

    await expect(upstream500.customPages('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(
      malformedEnvelope.customPages('opaque-token')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(invalidJson.customPages('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(network.customPages('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(timeout.customPages('opaque-token')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });
});
