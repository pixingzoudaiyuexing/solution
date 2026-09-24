import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { createRegistryModuleLkg, createRegistryOperationalSnapshot, persistRegistryOperationalSnapshot } from '../src/registry/operational';
import { RegistryValidationState } from '../src/registry/kernel';
import { FakeKV } from './helpers/fake-kv';
import { subscriptionDeliveryConfigSchema } from '../src/registry/modules/subscription-delivery';

const TOKEN = 'SYNTHETIC_TOKEN_DO_NOT_LOG_123';
async function kvWith(origin = 'https://sub.example.com', prefix = ''): Promise<FakeKV> {
  const kv = new FakeKV();
  const now = Date.now();
  const config = subscriptionDeliveryConfigSchema.parse({ defaultEntryId: 'primary', entries: [{ id: 'primary', label: { default: 'Subscription' }, enabled: true, selectable: true, publicOrigin: origin, pathPrefix: prefix }] });
  const lkg = await createRegistryModuleLkg({ moduleId: 'subscription-delivery', validatedAt: now, sourceFetchedAt: now, exposure: 'authenticated', config });
  const snapshot = await createRegistryOperationalSnapshot({ generatedAt: now, modules: [{ moduleId: 'subscription-delivery', latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true }, lkg }] });
  await persistRegistryOperationalSnapshot(kv.binding(), snapshot, registryOperationalDefinitions);
  return kv;
}
const env = (kv?: FakeKV) => ({ V2BOARD_BASE_URL: 'https://hidden.example/api/v1/', V2BOARD_SUBSCRIBE_PATH: '/client/subscribe', ...(kv ? { REGISTRY_KV: kv.binding() } : {}) });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const eligible = {
  data: { banned: 0, transfer_enable: 1024, expired_at: 253_402_300_799 },
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('subscription delivery APIs', () => {
  it.each(['/api/v1/subscription/delivery-options', '/api/v1/subscription/access-link'])('requires auth for %s', async (path) => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    const response = await app.request(path, path.endsWith('access-link') ? { method: 'POST' } : undefined, env());
    expect(response.status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns selectable delivery options after existing eligibility', async () => {
    const kv = await kvWith();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(eligible)); vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/subscription/delivery-options', { headers: { Authorization: 'Bearer user-token', 'cf-ray': 'rid' } }, env(kv));
    expect(await response.json()).toEqual({ ok: true, data: { defaultEntryId: 'primary', entries: [{ id: 'primary', label: 'Subscription' }] }, requestId: 'rid' });
    expect(String(fetcher.mock.calls[0][0])).toContain('/user/info');
  });

  it('returns empty options for eligible user when Registry unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(eligible)); vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/subscription/delivery-options', { headers: { Authorization: 'Bearer user-token' } }, env());
    expect(await response.json()).toMatchObject({ data: { defaultEntryId: null, entries: [] } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([401, 403])('maps eligibility auth %s canonically', async (status) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(json({ message: 'x' }, status)));
    const response = await app.request('/api/v1/subscription/delivery-options', { headers: { Authorization: 'Bearer bad' } }, env());
    expect(response.status).toBe(401); expect(await response.text()).toContain('AUTH_FAILED');
  });

  it.each([
    ['/api/v1/subscription/delivery-options', undefined],
    [
      '/api/v1/subscription/access-link',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: 'primary' }),
      },
    ],
  ])('returns explicit unavailability for expired entitlement on %s', async (path, init) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({ data: { banned: 0, transfer_enable: 1024, expired_at: 1 } })
    );
    vi.stubGlobal('fetch', fetcher);
    const headers = new Headers(init?.headers);
    headers.set('Authorization', 'Bearer user-token');

    const response = await app.request(path, { ...init, headers }, env(await kvWith()));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'SUBSCRIPTION_ACCESS_UNAVAILABLE' },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toContain('/user/info');
  });

  it.each([
    [json({ data: { banned: 0, expired_at: null } }), 502, 'UPSTREAM_ERROR'],
    [new DOMException('private timeout', 'TimeoutError'), 504, 'UPSTREAM_TIMEOUT'],
  ])('keeps unknown entitlement distinct from ineligibility', async (outcome, status, code) => {
    const fetcher = vi.fn<typeof fetch>();
    if (outcome instanceof Error) fetcher.mockRejectedValue(outcome);
    else fetcher.mockResolvedValue(outcome);
    vi.stubGlobal('fetch', fetcher);

    const response = await app.request(
      '/api/v1/subscription/delivery-options',
      { headers: { Authorization: 'Bearer user-token' } },
      env(await kvWith())
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['https://sub.example.com', '', 'show', `https://sub.example.com/${TOKEN}`],
    ['https://sub.example.com', '', 'hide', `https://sub.example.com/${TOKEN}?info=hide`],
    ['https://sub.example.com', 'zzz', 'show', `https://sub.example.com/zzz/${TOKEN}`],
    ['https://sub.example.com', 'zzz', 'hide', `https://sub.example.com/zzz/${TOKEN}?info=hide`],
  ])('generates canonical link', async (origin, prefix, info, expected) => {
    const kv = await kvWith(origin, prefix);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(eligible)).mockResolvedValueOnce(json({ data: { token: TOKEN, subscribe_url: `https://hidden.example/client/subscribe?token=${TOKEN}` } })); vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/subscription/access-link', { method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: 'primary', subscriptionInfo: info }) }, env(kv));
    expect(await response.json()).toMatchObject({ data: { accessUrl: expected } });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(['https://hidden.example/api/v1/user/info', 'https://hidden.example/api/v1/user/getSubscribe']);
  });

  it('fails closed on token mismatch and hidden-origin conflict without leaking credentials', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let kv = await kvWith();
    let fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(eligible)).mockResolvedValueOnce(json({ data: { token: TOKEN, subscribe_url: 'https://hidden.example/client/subscribe?token=OTP_DIFFERENT' } })); vi.stubGlobal('fetch', fetcher);
    let response = await app.request('/api/v1/subscription/access-link', { method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: 'primary' }) }, env(kv));
    expect(response.status).toBe(422); expect(await response.text()).not.toContain(TOKEN);
    kv = await kvWith('https://hidden.example');
    fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(eligible)); vi.stubGlobal('fetch', fetcher);
    response = await app.request('/api/v1/subscription/delivery-options', { headers: { Authorization: 'Bearer user-token' } }, env(kv));
    expect(await response.json()).toMatchObject({ data: { entries: [] } });
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
  });

  it.each(['https://hidden.example', 'https://hidden.example/', 'https://hidden.example.', 'https://HIDDEN.EXAMPLE'])('fails both consumers closed for hidden equivalent %s', async (origin) => {
    const kv = await kvWith(origin);
    let fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(eligible)); vi.stubGlobal('fetch', fetcher);
    let response = await app.request('/api/v1/subscription/delivery-options', { headers: { Authorization: 'Bearer user-token' } }, env(kv));
    expect(await response.json()).toMatchObject({ data: { defaultEntryId: null, entries: [] } });
    expect(fetcher).toHaveBeenCalledOnce();

    fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(eligible)); vi.stubGlobal('fetch', fetcher);
    response = await app.request('/api/v1/subscription/access-link', { method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: 'primary' }) }, env(kv));
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain('hidden.example');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toContain('/user/info');
  });

  it.each([
    ['malformed direct token', { data: { token: 'bad.token', subscribe_url: `https://hidden.example/x?token=${TOKEN}` } }],
    ['malformed URL', { data: { token: TOKEN, subscribe_url: 'not-a-url' } }],
    ['missing URL token', { data: { token: TOKEN, subscribe_url: 'https://hidden.example/x' } }],
    ['duplicate URL token', { data: { token: TOKEN, subscribe_url: `https://hidden.example/x?token=${TOKEN}&token=${TOKEN}` } }],
    ['invalid URL token', { data: { token: TOKEN, subscribe_url: 'https://hidden.example/x?token=bad.token' } }],
    ['OTP/time mismatch', { data: { token: TOKEN, subscribe_url: 'https://hidden.example/x?token=DERIVED_OTHER' } }],
  ])('fails closed for %s', async (_case, payload) => {
    const kv = await kvWith();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(eligible)).mockResolvedValueOnce(json(payload));
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/subscription/access-link', { method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: 'primary' }) }, env(kv));
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain(TOKEN);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['malformed JSON', '{'],
    ['unknown field', JSON.stringify({ entryId: 'primary', unknown: true })],
    ['invalid entry id', JSON.stringify({ entryId: 'Bad_ID' })],
    ['non-default profile', JSON.stringify({ entryId: 'primary', profileId: 'meta' })],
    ['invalid info', JSON.stringify({ entryId: 'primary', subscriptionInfo: 'other' })],
  ])('rejects request contract %s before upstream', async (_case, body) => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/subscription/access-link', { method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body }, env());
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rechecks current entitlement when access-link follows delivery-options', async () => {
    const kv = await kvWith();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(eligible))
      .mockResolvedValueOnce(
        json({ data: { banned: 0, transfer_enable: 1024, expired_at: 1 } })
      );
    vi.stubGlobal('fetch', fetcher);

    const options = await app.request(
      '/api/v1/subscription/delivery-options',
      { headers: { Authorization: 'Bearer user-token' } },
      env(kv)
    );
    expect(options.status).toBe(200);

    const access = await app.request(
      '/api/v1/subscription/access-link',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer user-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entryId: 'primary' }),
      },
      env(kv)
    );
    expect(access.status).toBe(409);
    expect(await access.json()).toMatchObject({
      error: { code: 'SUBSCRIPTION_ACCESS_UNAVAILABLE' },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://hidden.example/api/v1/user/info',
      'https://hidden.example/api/v1/user/info',
    ]);
  });
});
