import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { app } from '../src/index';
import { V2BoardSubscriptionAdapter } from '../src/adapters/v2board/subscription';
import { CC_MAX_YAML_BYTES, CC_RULE_CATALOG, transformCcProfile } from '../src/security/cc-profile';
import { subscriptionProfileConfigSchema } from '../src/registry/modules/subscription-profile';
import { registryOperationalDefinitions } from '../src/registry/definitions';
import { createRegistryModuleLkg, createRegistryOperationalSnapshot, persistRegistryOperationalSnapshot } from '../src/registry/operational';
import { RegistryValidationState } from '../src/registry/kernel';
import { FakeKV } from './helpers/fake-kv';
import { subscriptionDeliveryConfigSchema } from '../src/registry/modules/subscription-delivery';

const TOKEN = 'SYNTHETIC_TOKEN_DO_NOT_LOG_123';
const SECRET = 'SYNTHETIC_NODE_SECRET_DO_NOT_LOG';
const ids = ['youtube', 'google', 'ai', 'netflix', 'disney', 'tiktok', 'bilibili'] as const;
const labels = ['YouTube', 'Google', 'AI', 'Netflix', 'Disney', 'TikTok', 'Bilibili'];
const config = subscriptionProfileConfigSchema.parse({
  profileId: 'cc', enabled: true, label: { default: 'Clash 分流规则' },
  groups: ids.map((id, index) => ({ id, enabled: true, label: { default: labels[index] }, defaultPolicy: id === 'bilibili' ? 'direct' : 'auto' })),
});
const upstream = `mixed-port: 7890
mode: rule
external-controller: 127.0.0.1:9090
dns:
  enable: true
  nameserver: [1.1.1.1]
proxies:
  - name: Node One
    type: ss
    server: node.example
    port: 443
    cipher: aes-128-gcm
    password: ${SECRET}
  - name: Node Two
    type: trojan
    server: second.example
    port: 443
    password: other-secret
proxy-groups:
  - name: Upstream Automatic
    type: url-test
    proxies: [Node One, Node Two]
    url: https://www.gstatic.com/generate_204
    interval: 300
  - name: Upstream Failover
    type: fallback
    proxies: [Node One, Node Two]
    url: https://www.gstatic.com/generate_204
    interval: 300
  - name: Manual Nodes
    type: select
    proxies: [Upstream Automatic, Node One, Node Two]
rules:
  - MATCH,Manual Nodes
`;

async function profileKv(enabled = true, withDelivery = false): Promise<FakeKV> {
  const kv = new FakeKV();
  const value = { ...config, enabled };
  const now = Date.now();
  const lkg = await createRegistryModuleLkg({ moduleId: 'subscription-profile', validatedAt: now, sourceFetchedAt: now, exposure: 'authenticated', config: value });
  const modules: any[] = [{ moduleId: 'subscription-profile', latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true }, lkg }];
  if (withDelivery) {
    const delivery = subscriptionDeliveryConfigSchema.parse({ defaultEntryId: 'primary', entries: [{ id: 'primary', label: { default: 'Subscription' }, enabled: true, selectable: true, publicOrigin: 'https://sub.example.com', pathPrefix: '' }] });
    const deliveryLkg = await createRegistryModuleLkg({ moduleId: 'subscription-delivery', validatedAt: now, sourceFetchedAt: now, exposure: 'authenticated', config: delivery });
    modules.push({ moduleId: 'subscription-delivery', latest: { state: RegistryValidationState.VALID_ENABLED, enabled: true }, lkg: deliveryLkg });
  }
  const snapshot = await createRegistryOperationalSnapshot({ generatedAt: now, modules });
  await persistRegistryOperationalSnapshot(kv.binding(), snapshot, registryOperationalDefinitions);
  return kv;
}

const env = (kv?: FakeKV) => ({
  V2BOARD_BASE_URL: 'https://hidden.example/api/v1/', V2BOARD_SUBSCRIBE_PATH: '/client/subscribe',
  ...(kv ? { REGISTRY_KV: kv.binding() } : {}),
});
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const eligible = { data: { banned: 0, transfer_enable: 1024, expired_at: 253_402_300_799 } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('CC Registry and source catalog', () => {
  it('accepts ordered known logical groups and rejects arbitrary transform inputs', () => {
    expect(subscriptionProfileConfigSchema.parse(config).groups.map((group) => group.id)).toEqual(ids);
    for (const mutation of [
      { url: 'https://attacker.example/rules.mrs' },
      { yaml: 'rules: []' },
      { script: 'run()' },
      { regex: '.*' },
      { groupGraph: { a: ['b'] } },
    ]) expect(subscriptionProfileConfigSchema.safeParse({ ...config, ...mutation }).success).toBe(false);
    expect(subscriptionProfileConfigSchema.safeParse({ ...config, groups: [{ ...config.groups[0], id: 'unknown' }, ...config.groups.slice(1)] }).success).toBe(false);
    expect(subscriptionProfileConfigSchema.safeParse({ ...config, groups: [config.groups[0], config.groups[0], ...config.groups.slice(2)] }).success).toBe(false);
    expect(CC_RULE_CATALOG.google.url).toBe('https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.mrs');
    expect(Object.values(CC_RULE_CATALOG).every((item) => item.url.startsWith('https://'))).toBe(true);
  });
});

describe('bounded CC YAML transformation', () => {
  it('preserves nodes, credentials and safe settings while applying visible and hidden policy', () => {
    const output = parse(transformCcProfile(upstream, config));
    expect(output.proxies).toEqual(parse(upstream).proxies);
    expect(output.proxies[0].password).toBe(SECRET);
    expect(output.dns).toEqual({ enable: true, nameserver: ['1.1.1.1'] });
    expect(output['mixed-port']).toBe(7890);
    expect(output['external-controller']).toBe('127.0.0.1:9090');
    expect(output['proxy-groups'].map((group: { name: string }) => group.name)).toEqual([
      'Upstream Automatic', 'Upstream Failover', ...labels, 'Manual Nodes',
    ]);
    expect(output['proxy-groups'][2].proxies).toEqual(['Upstream Automatic', 'Upstream Failover', 'Node One', 'Node Two']);
    expect(output['proxy-groups'][8].proxies).toEqual(['DIRECT', 'Upstream Automatic', 'Upstream Failover', 'Node One', 'Node Two']);
    expect(output.rules).toEqual([
      'RULE-SET,cc-private,DIRECT', 'RULE-SET,cc-privateip,DIRECT,no-resolve', 'RULE-SET,cc-ads,REJECT',
      ...ids.map((id, index) => `RULE-SET,cc-${id},${labels[index]}`),
      'RULE-SET,cc-cn,DIRECT', 'RULE-SET,cc-cnip,DIRECT,no-resolve',
      'RULE-SET,cc-proxy,Upstream Automatic', 'MATCH,Upstream Automatic',
    ]);
    expect(output['rule-providers']['cc-google'].url).toBe(CC_RULE_CATALOG.google.url);
    expect(transformCcProfile(upstream, config)).toBe(transformCcProfile(upstream, config));
  });

  it('honors configured group order and disabled logical groups', () => {
    const customized = { ...config, groups: [config.groups[6], { ...config.groups[1], enabled: false }, ...config.groups.filter((group) => group.id !== 'bilibili' && group.id !== 'google')] };
    const output = parse(transformCcProfile(upstream, customized));
    expect(output['proxy-groups'].slice(2, 4).map((group: { name: string }) => group.name)).toEqual(['Bilibili', 'YouTube']);
    expect(output['rule-providers']['cc-google']).toBeUndefined();
    expect(output.rules.some((rule: string) => rule.includes('cc-google'))).toBe(false);
  });

  it('creates only missing automatic/fallback base groups', () => {
    const simple = upstream.slice(0, upstream.indexOf('proxy-groups:')) + 'proxy-groups: []\n';
    const output = parse(transformCcProfile(simple, config));
    expect(output['proxy-groups'].slice(0, 2).map((group: { name: string }) => group.name)).toEqual(['自动选择', '故障转移']);
  });

  it('does not use a direct-only upstream group as the default proxy policy', () => {
    const directOnly = upstream.replaceAll('proxies: [Node One, Node Two]', 'proxies: [DIRECT]');
    const output = parse(transformCcProfile(directOnly, config));
    expect(output['proxy-groups'].slice(0, 2).map((group: { name: string }) => group.name)).toEqual(['自动选择', '故障转移']);
    expect(output['proxy-groups'][2].proxies.slice(0, 2)).toEqual(['自动选择', '故障转移']);
    expect(output.rules.at(-1)).toBe('MATCH,自动选择');
  });

  it.each([
    ['malformed', 'proxies: ['],
    ['alias', `${upstream}\nextra: *node`],
    ['anchor', upstream.replace('name: Node One', 'name: &node Node One')],
    ['custom tag', upstream.replace('name: Node One', 'name: !unsafe Node One')],
    ['duplicate proxy', upstream.replace('  - name: Node Two', '  - name: Node One')],
    ['duplicate group', upstream.replace('name: Manual Nodes', 'name: Upstream Automatic')],
    ['cycle', upstream.replace('proxies: [Upstream Automatic, Node One, Node Two]', 'proxies: [Manual Nodes, Node One, Node Two]')],
    ['managed collision', upstream.replace('name: Manual Nodes', 'name: YouTube')],
    ['unknown top level', `${upstream}\nscript: dangerous`],
    ['unsafe controller', upstream.replace('127.0.0.1:9090', '0.0.0.0:9090')],
    ['global mode', upstream.replace('mode: rule', 'mode: global')],
    ['invalid port', upstream.replace('mixed-port: 7890', 'mixed-port: outside')],
    ['invalid DNS', upstream.replace('dns:\n  enable: true\n  nameserver: [1.1.1.1]', 'dns: bad')],
    ['duplicate mapping key', `${upstream}\nmode: rule`],
    ['group comma', upstream.replace('name: Manual Nodes', 'name: "Manual, Nodes"')],
    ['dialer graph', upstream.replace('    type: ss', '    type: ss\n    dialer-proxy: Manual Nodes')],
    ['provider fetch', `${upstream}\nproxy-providers: { bad: { url: https://example.com/x } }`],
    ['no proxies', upstream.replace(/proxies:\n  - name: Node One[\s\S]*?proxy-groups:/, 'proxies: []\nproxy-groups:')],
  ])('rejects %s', (_label, value) => expect(() => transformCcProfile(value, config)).toThrow());

  it('rejects oversized input before parsing', () => {
    expect(() => transformCcProfile('x'.repeat(CC_MAX_YAML_BYTES + 1), config)).toThrow();
  });
});

describe('public and authenticated CC routes', () => {
  it('keeps default requests byte-streamed without invoking CC transformation', async () => {
    const cc = vi.spyOn(V2BoardSubscriptionAdapter.prototype, 'ccProfileContent');
    const upstreamBodies: ReadableStream<Uint8Array>[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array([0, 255, 3])); controller.close(); } });
      const response = new Response(body, { headers: { 'subscription-userinfo': 'upload=1' } });
      upstreamBodies.push(response.body!);
      return response;
    });
    vi.stubGlobal('fetch', fetcher);
    for (const suffix of ['', '?profile=default']) {
      const kv = await profileKv();
      const response = await app.request(`https://gateway.example/${TOKEN}${suffix}`, {}, env(kv));
      expect(response.status).toBe(200);
      expect(response.body).toBe(upstreamBodies.at(-1));
      expect(response.headers.get('subscription-userinfo')).toBe('upload=1');
      expect(fetcher.mock.calls.at(-1)?.[0]).toBe(`https://hidden.example/client/subscribe?token=${TOKEN}`);
      expect(kv.reads).toEqual([]);
    }
    expect(cc).not.toHaveBeenCalled();
  });

  it('fetches fixed meta format and returns generic errors without secrets', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(upstream, { headers: { 'subscription-userinfo': 'upload=1', 'profile-title': 'CC' } }));
    vi.stubGlobal('fetch', fetcher);
    const kv = await profileKv();
    const response = await app.request(`https://gateway.example/prefix/${TOKEN}?profile=cc&info=hide`, {}, env(kv));
    expect(response.status).toBe(200);
    expect(response.headers.get('subscription-userinfo')).toBeNull();
    expect(response.headers.get('profile-title')).toBe('CC');
    expect(parse(await response.text())['proxy-groups'][2].name).toBe('YouTube');
    expect(String(fetcher.mock.calls[0][0])).toBe(`https://hidden.example/client/subscribe?token=${TOKEN}&flag=meta`);
    const show = await app.request(`https://gateway.example/${TOKEN}?profile=cc&info=show`, {}, env(kv));
    expect(show.headers.get('subscription-userinfo')).toBe('upload=1');
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
  });

  it.each([`/${TOKEN}?profile=cc&profile=cc`, `/${TOKEN}?profile=unknown`, `/${TOKEN}?profile=cc&flag=meta`, `/${TOKEN}?profile=cc&info=hide&info=hide`])('rejects invalid public query %s before fetch', async (path) => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    const response = await app.request(`https://gateway.example${path}`, {}, env(await profileKv()));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('subscription_unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed for disabled profile and oversized upstream body', async () => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    let response = await app.request(`https://gateway.example/${TOKEN}?profile=cc`, {}, env(await profileKv(false)));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('subscription_unavailable');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(new Response('x'.repeat(CC_MAX_YAML_BYTES + 1)));
    response = await app.request(`https://gateway.example/${TOKEN}?profile=cc`, {}, env(await profileKv()));
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('subscription_unavailable');
    fetcher.mockResolvedValue(new Response('small', { headers: { 'Content-Length': String(CC_MAX_YAML_BYTES + 1) } }));
    response = await app.request(`https://gateway.example/${TOKEN}?profile=cc`, {}, env(await profileKv()));
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('subscription_unavailable');
  });

  it('fails generically for malformed upstream YAML and corrupt Registry without logging credentials', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const kv = await profileKv();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(upstream.replace('name: Node Two', 'name: Node One')));
    vi.stubGlobal('fetch', fetcher);
    let response = await app.request(`https://gateway.example/${TOKEN}?profile=cc`, {}, env(kv));
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('subscription_unavailable');
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
    kv.values.set('registry:snapshot:v1', '{"corrupt":true}');
    fetcher.mockClear();
    response = await app.request(`https://gateway.example/${TOKEN}?profile=cc`, {}, env(kv));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('subscription_unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('exposes neutral profile capability and canonical access links', async () => {
    const kv = await profileKv(true, true);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(eligible))
      .mockResolvedValueOnce(json(eligible))
      .mockResolvedValueOnce(json({ data: { token: TOKEN, subscribe_url: `https://hidden.example/client/subscribe?token=${TOKEN}` } }))
      .mockResolvedValueOnce(json(eligible))
      .mockResolvedValueOnce(json({ data: { token: TOKEN, subscribe_url: `https://hidden.example/client/subscribe?token=${TOKEN}` } }));
    vi.stubGlobal('fetch', fetcher);
    const options = await app.request('/api/v1/subscription/delivery-options', { headers: { Authorization: 'Bearer user-token' } }, env(kv));
    expect((await options.json() as any).data.profiles).toEqual([
      { id: 'default', label: 'Default', available: true },
      { id: 'cc', label: 'Clash 分流规则', available: true },
    ]);
    for (const [profileId, subscriptionInfo, expected] of [
      ['default', 'show', `https://sub.example.com/${TOKEN}`],
      ['cc', 'hide', `https://sub.example.com/${TOKEN}?profile=cc&info=hide`],
    ]) {
      const response = await app.request('/api/v1/subscription/access-link', {
        method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: 'primary', profileId, subscriptionInfo }),
      }, env(kv));
      expect((await response.json() as any).data.accessUrl).toBe(expected);
    }
  });

  it('rejects a disabled CC link before requesting a normal token', async () => {
    const kv = await profileKv(false, true);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(eligible));
    vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/v1/subscription/access-link', {
      method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId: 'primary', profileId: 'cc' }),
    }, env(kv));
    expect(response.status).toBe(422);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toContain('/user/info');
  });
});
