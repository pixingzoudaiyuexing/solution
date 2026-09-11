import { describe, expect, it, vi } from 'vitest';
import { V2BoardClient } from '../src/adapters/v2board/client';
import {
  V2BoardOrderCancelError,
  V2BoardOrderNotCancellableError,
  V2BoardOrderNotFoundError,
  V2BoardTimeoutError,
  V2BoardUpstreamError,
} from '../src/adapters/v2board/errors';
import { V2BoardOrdersAdapter } from '../src/adapters/v2board/orders';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createAdapter(fetcher: typeof fetch): V2BoardOrdersAdapter {
  return new V2BoardOrdersAdapter(
    new V2BoardClient(
      { baseUrl: 'https://backend.example/api/v1/' },
      fetcher
    )
  );
}

describe('V2BoardOrdersAdapter order status', () => {
  it.each([
    [0, 'pending'],
    [1, 'processing'],
    [2, 'cancelled'],
    [3, 'completed'],
    [4, 'adjusted'],
  ] as const)('reuses status mapping %s -> %s', async (upstream, expected) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: upstream }));
    const adapter = createAdapter(fetcher);

    await expect(adapter.orderStatus('opaque-token', 'order-001')).resolves.toBe(
      expected
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://backend.example/api/v1/user/order/check?trade_no=order-001'
    );
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
  });

  it('maps an exact missing order response', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Order does not exist' }, 500)
      )
    );
    await expect(
      adapter.orderStatus('opaque-token', 'missing-order')
    ).rejects.toBeInstanceOf(V2BoardOrderNotFoundError);
  });

  it.each([{ data: 9 }, { data: '3' }, { status: 3 }])(
    'fails closed on malformed status %#',
    async (payload) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload))
      );
      await expect(
        adapter.orderStatus('opaque-token', 'order-001')
      ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    }
  );

  it('normalizes unknown failure and timeout', async () => {
    const unknown = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Database unavailable' }, 500)
      )
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    await expect(
      unknown.orderStatus('opaque-token', 'order-001')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timeout.orderStatus('opaque-token', 'order-001')
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });
});

describe('V2BoardOrdersAdapter cancellation', () => {
  it('submits only trade_no and accepts data=true', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: true, internal: 'ignored' }));
    const adapter = createAdapter(fetcher);

    await expect(adapter.cancelOrder('opaque-token', 'order-001')).resolves.toEqual({
      cancelled: true,
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://backend.example/api/v1/user/order/cancel');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ trade_no: 'order-001' });
    expect(new Headers(init?.headers).get('authorization')).toBe('opaque-token');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['Order does not exist', '订单不存在'])(
    'maps exact missing order: %s',
    async (message) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
      );
      await expect(
        adapter.cancelOrder('opaque-token', 'missing-order')
      ).rejects.toBeInstanceOf(V2BoardOrderNotFoundError);
    }
  );

  it.each(['You can only cancel pending orders', '只可以取消待支付订单'])(
    'maps exact non-cancellable order: %s',
    async (message) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
      );
      await expect(
        adapter.cancelOrder('opaque-token', 'order-001')
      ).rejects.toBeInstanceOf(V2BoardOrderNotCancellableError);
    }
  );

  it.each(['Cancel failed', '取消失败'])(
    'maps exact cancellation failure: %s',
    async (message) => {
      const adapter = createAdapter(
        vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message }, 500))
      );
      await expect(
        adapter.cancelOrder('opaque-token', 'order-001')
      ).rejects.toBeInstanceOf(V2BoardOrderCancelError);
    }
  );

  it('does not classify an error that only contains a known message', async () => {
    const adapter = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Cancel failed: database unavailable' }, 500)
      )
    );
    await expect(
      adapter.cancelOrder('opaque-token', 'order-001')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
  });

  it('fails closed on malformed success, unknown failure, and timeout', async () => {
    const malformed = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: false }))
    );
    const unknown = createAdapter(
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ message: 'Unexpected cancel error' }, 500)
      )
    );
    const timeout = createAdapter(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    await expect(
      malformed.cancelOrder('opaque-token', 'order-001')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      unknown.cancelOrder('opaque-token', 'order-001')
    ).rejects.toBeInstanceOf(V2BoardUpstreamError);
    await expect(
      timeout.cancelOrder('opaque-token', 'order-001')
    ).rejects.toBeInstanceOf(V2BoardTimeoutError);
  });
});
