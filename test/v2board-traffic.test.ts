import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardTrafficAdapter } from '../src/adapters/v2board/traffic';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardTrafficAdapter {
  return new V2BoardTrafficAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

function upstreamEntry(overrides: Record<string, unknown> = {}) {
  return {
    u: 123456,
    d: 654321,
    record_at: 1704067200,
    user_id: 99,
    server_rate: '1.50',
    private_field: 'must-not-leak',
    ...overrides,
  };
}

describe('V2BoardTrafficAdapter', () => {
  it('returns an empty traffic history', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }))
    );
    await expect(adapter.logs('opaque-token')).resolves.toEqual([]);
  });

  it('maps bytes, timestamp, decimal rate, preserves order, and strips user_id', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          upstreamEntry(),
          upstreamEntry({
            u: 1,
            d: 2,
            record_at: 1703980800,
            server_rate: '0.00',
          }),
        ],
      })
    );
    const adapter = createAdapter(fetcher);

    await expect(adapter.logs('opaque-token')).resolves.toEqual([
      {
        uploadedBytes: 123456,
        downloadedBytes: 654321,
        recordedAt: '2024-01-01T00:00:00.000Z',
        rateMultiplier: 1.5,
      },
      {
        uploadedBytes: 1,
        downloadedBytes: 2,
        recordedAt: '2023-12-31T00:00:00.000Z',
        rateMultiplier: 0,
      },
    ]);

    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/stat/getTrafficLog');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it.each([
    ['negative upload', upstreamEntry({ u: -1 })],
    ['negative download', upstreamEntry({ d: -1 })],
    ['float upload', upstreamEntry({ u: 1.5 })],
    ['float download', upstreamEntry({ d: 1.5 })],
    ['unsafe bytes', upstreamEntry({ u: Number.MAX_SAFE_INTEGER + 1 })],
    ['string bytes', upstreamEntry({ d: '654321' })],
    ['negative timestamp', upstreamEntry({ record_at: -1 })],
    ['string timestamp', upstreamEntry({ record_at: '1704067200' })],
    ['numeric rate', upstreamEntry({ server_rate: 1.5 })],
    ['short decimal rate', upstreamEntry({ server_rate: '1.5' })],
    ['integer string rate', upstreamEntry({ server_rate: '1' })],
    ['negative rate', upstreamEntry({ server_rate: '-1.00' })],
    ['non-numeric rate', upstreamEntry({ server_rate: 'fast' })],
  ])('fails closed on malformed entry: %s', async (_case, entry) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [entry] }))
    );
    await expect(adapter.logs('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it.each([
    {},
    { data: null },
    { data: upstreamEntry() },
    { entries: [] },
  ])('fails closed on malformed envelope %#', async (payload) => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
    );
    await expect(adapter.logs('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
  });

  it('normalizes upstream failure and timeout', async () => {
    const failed = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Database unavailable' }, 500)
      )
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    await expect(failed.logs('opaque-token')).rejects.toBeInstanceOf(
      V2BoardUpstreamError
    );
    await expect(timeout.logs('opaque-token')).rejects.toBeInstanceOf(
      V2BoardTimeoutError
    );
  });
});
