import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app, scheduled } from '../src/index';
import { createRegistryAlertState, loadRegistryAlertState, loadRegistryHealth, persistRegistryAlertState, persistRegistryHealth, REGISTRY_ALERT_KEY, REGISTRY_HEALTH_KEY } from '../src/registry/operational';
import { FakeKV } from './helpers/fake-kv';
import { health, telegramEnv, telegramSuccess, TEST_OWNER, TEST_SECRET, update } from './helpers/telegram';

const endpoint = 'https://worker.example/internal/telegram/webhook';
const start = 1_800_000_000_000;
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': TEST_SECRET, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
function provider() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.telegram.org') return telegramSuccess();
    expect(url.origin).toBe('https://panel.example');
    expect(url.pathname).toBe('/api/v1/admin/knowledge/fetch');
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    return Response.json({ data: [] });
  });
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Telegram webhook authentication and parsing', () => {
  it.each([undefined, '', 'wrong', TEST_SECRET + 'x', TEST_SECRET.toUpperCase()])('rejects secret %s without consuming body, reading KV or fetching', async (secret) => {
    const kv = new FakeKV(); const env = telegramEnv(kv); const fetcher = provider(); vi.stubGlobal('fetch', fetcher);
    const req = request(update());
    if (secret === undefined) req.headers.delete('X-Telegram-Bot-Api-Secret-Token');
    else req.headers.set('X-Telegram-Bot-Api-Secret-Token', secret);
    const response = await app.fetch(req, env);
    expect(response.status).toBe(403); expect(req.bodyUsed).toBe(false);
    expect(kv.reads).toEqual([]); expect(kv.writes).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
    expect(await response.text()).toBe('');
  });
  it.each(['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])('accepts only POST (%s)', async (method) => {
    const kv = new FakeKV();
    expect((await app.fetch(new Request(endpoint, { method }), telegramEnv(kv))).status).toBe(405);
    expect(kv.reads).toEqual([]);
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded', '', 'application/json-bad'])('rejects unsupported content type %s', async (type) => {
    const kv = new FakeKV();
    expect((await app.fetch(request(update(), { 'content-type': type }), telegramEnv(kv))).status).toBe(415);
    expect(kv.reads).toEqual([]);
  });
  it.each(['{', 'null', '[]', '{}', '{"message":null}', '{"update_id":1,"channel_post":{}}', '{"update_id":1,"edited_message":{}}'])('safely rejects/ignores malformed or unsupported update %s', async (body) => {
    const kv = new FakeKV(); const fetcher = provider(); vi.stubGlobal('fetch', fetcher);
    const response = await app.fetch(request(body), telegramEnv(kv));
    expect([200, 400]).toContain(response.status); expect(await response.text()).toBe('');
    expect(kv.reads).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds actual bytes even without Content-Length and rejects oversize declarations', async () => {
    const kv = new FakeKV();
    for (const req of [request(' '.repeat(16_385)), request(update(), { 'content-length': '16385' }), request(update(), { 'content-length': 'invalid' })]) {
      expect((await app.fetch(req, telegramEnv(kv))).status).toBe(400);
    }
    expect(kv.reads).toEqual([]);
  });
  it('rejects malformed UTF-8', async () => {
    const req = new Request(endpoint, { method: 'POST', headers: request({}).headers, body: new Uint8Array([0xff, 0xfe]) });
    expect((await app.fetch(req, telegramEnv())).status).toBe(400);
  });
  it('bounds a stalled authenticated request body before reading health', async () => {
    const kv = new FakeKV();
    const req = new Request(endpoint, { method: 'POST', headers: request({}).headers, body: new ReadableStream(), duplex: 'half' } as RequestInit);
    const pending = app.fetch(req, telegramEnv(kv));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(400); expect(kv.reads).toEqual([]);
  });
  it.each([
    { from: { id: TEST_OWNER + 1, is_bot: false } },
    { from: { id: String(TEST_OWNER), is_bot: false } },
    { from: { id: TEST_OWNER, is_bot: true } },
    { chat: { id: TEST_OWNER + 1, type: 'private' } },
    { chat: { id: -TEST_OWNER, type: 'group' } },
    { chat: { id: TEST_OWNER, type: 'supergroup' } },
    { chat: { id: TEST_OWNER, type: 'channel' } },
    { text: undefined, photo: [{}] },
  ])('requires exact Owner sender and private Owner chat %j', async (override) => {
    const kv = new FakeKV(); const u = update('/check'); Object.assign(u.message, override);
    const fetcher = provider(); vi.stubGlobal('fetch', fetcher);
    const response = await app.fetch(request(u), telegramEnv(kv));
    expect(response.status).toBe(200); expect(await response.text()).toBe('');
    expect(kv.reads).toEqual([]); expect(kv.writes).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '123.0', '0123456789', '9007199254740992', '123456789\n'])('fails closed on invalid configured Owner ID %s', async (owner) => {
    const kv = new FakeKV(); const env = telegramEnv(kv); env.TELEGRAM_OWNER_USER_ID = owner;
    expect((await app.fetch(request(update()), env)).status).toBe(403); expect(kv.reads).toEqual([]);
  });
});

describe('Owner commands use existing operational health and refresh', () => {
  it('/health reads existing health without refresh or any writes, and deduplicates successful retries', async () => {
    const kv = new FakeKV(); await persistRegistryHealth(kv.binding(), health()); kv.writes.length = 0;
    const fetcher = provider(); vi.stubGlobal('fetch', fetcher); const env = telegramEnv(kv);
    for (let n = 0; n < 2; n++) expect((await app.fetch(request(update()), env)).status).toBe(200);
    expect(kv.reads).toEqual([REGISTRY_HEALTH_KEY]); expect(kv.writes).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
    const outgoing = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(outgoing.chat_id).toBe(TEST_OWNER); expect(outgoing.text).toContain('导航：正常');
  });
  it('/health reports missing records without refreshing', async () => {
    const fetcher = provider(); vi.stubGlobal('fetch', fetcher);
    expect((await app.fetch(request(update()), telegramEnv())).status).toBe(200);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).text).toContain('暂时没有可用的健康记录');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['/check arg', '/health arg', '/check\n', ' /check', '/CHECK', '/health@UnknownBot', '/check@UnknownBot', '/deploy', '/check;rm -rf /', '/check\u200b', '../../etc/passwd', "' OR 1=1--", '<img onerror=x>', '/check\u202e'])('strict command allowlist: %j gets help without KV reads', async (command) => {
    const kv = new FakeKV(); const fetcher = provider(); vi.stubGlobal('fetch', fetcher);
    expect((await app.fetch(request(update(command)), telegramEnv(kv))).status).toBe(200);
    expect(kv.reads).toEqual([]); expect(kv.writes).toEqual([]);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).text).toBe('可用命令：\n/health 查看健康状态\n/check 检查一次');
  });
  it('deterministically fuzzes hostile command strings without allowing refresh', async () => {
    const kv = new FakeKV(); const fetcher = provider(); vi.stubGlobal('fetch', fetcher); const env = telegramEnv(kv);
    let seed = 42;
    for (let n = 0; n < 50; n++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const command = `/check${String.fromCharCode(seed % 0x10000)}${seed.toString(16)}`;
      expect((await app.fetch(request(update(command, 1000 + n)), env)).status).toBe(200);
    }
    expect(kv.reads).toEqual([]); expect(kv.writes).toEqual([]); expect(fetcher).toHaveBeenCalledTimes(50);
  });
  it('/check refreshes only through GET source reads and existing derived state; concurrent/repeated delivery is safe locally', async () => {
    const kv = new FakeKV(); const env = telegramEnv(kv); const fetcher = provider(); vi.stubGlobal('fetch', fetcher);
    const replies = await Promise.all([app.fetch(request(update('/check')), env), app.fetch(request(update('/check')), env)]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('knowledge/fetch'))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('api.telegram.org'))).toHaveLength(1);
    expect((await loadRegistryHealth(kv.binding()))?.modules).toHaveLength(7);
    expect((await loadRegistryAlertState(kv.binding()))?.delivery?.lastCheck?.updateSequence).toBe(100);
    expect(kv.writes.filter(({ key }) => key === REGISTRY_ALERT_KEY)).toHaveLength(1);
    expect([...kv.values.keys()].sort()).toEqual(['registry:alert:v1', 'registry:health:v1', 'registry:snapshot:v1']);
    const outgoing = JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).text;
    for (const secret of [env.TELEGRAM_BOT_TOKEN!, env.TELEGRAM_WEBHOOK_SECRET!, env.TELEGRAM_OWNER_USER_ID!, env.V2BOARD_CONTROL_AUTH_DATA!]) {
      expect(outgoing).not.toContain(secret); expect([...kv.values.values()].join('')).not.toContain(secret);
    }
  });
  it('throttles distinct /check commands and rejects late older retries using persisted watermark', async () => {
    const kv = new FakeKV(); const env = telegramEnv(kv); const fetcher = provider(); vi.stubGlobal('fetch', fetcher);
    await app.fetch(request(update('/check', 200)), env);
    await app.fetch(request(update('/check', 201)), env);
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).text).toContain('刚刚已经检查过');
    vi.setSystemTime(start + 31_000);
    await app.fetch(request(update('/check', 202)), env);
    await app.fetch(request(update('/check', 199)), env);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('knowledge/fetch'))).toHaveLength(2);
  });
  it('retries a failed reply without re-running the completed /check', async () => {
    const kv = new FakeKV(); const env = telegramEnv(kv); let sends = 0;
    const fetcher = provider(); vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes('api.telegram.org') && sends++ === 0) return Response.json({ ok: false }, { status: 500 });
      return fetcher(input, init);
    }));
    expect((await app.fetch(request(update('/check')), env)).status).toBe(503);
    expect((await app.fetch(request(update('/check')), env)).status).toBe(200);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('knowledge/fetch'))).toHaveLength(1);
  });
  it('reports source failure in Chinese and missing KV as incomplete check', async () => {
    const kv = new FakeKV(); const env = telegramEnv(kv);
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input).includes('api.telegram.org') ? telegramSuccess() : Response.json({ secret: 'DO_NOT_LEAK' }, { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    expect((await app.fetch(request(update('/check')), env)).status).toBe(200);
    const output = JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).text;
    expect(output).toContain('访问凭据失效'); expect(output).not.toMatch(/DO_NOT_LEAK|CONTROL_PLANE/);
    delete env.REGISTRY_KV;
    expect((await app.fetch(request(update('/check', 101)), env)).status).toBe(200);
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).text).toContain('本次检查暂时未完成');
  });
  it('does not present failed persistence as a completed check', async () => {
    const kv = new FakeKV();
    kv.put = async () => { throw new Error('SENSITIVE_PERSISTENCE_ERROR'); };
    const fetcher = provider(); vi.stubGlobal('fetch', fetcher);
    expect((await app.fetch(request(update('/check')), telegramEnv(kv))).status).toBe(200);
    const outgoing = JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string).text;
    expect(outgoing).toContain('本次检查暂时未完成'); expect(outgoing).not.toContain('SENSITIVE');
    expect(kv.values.size).toBe(0);
  });
});

describe('scheduled Telegram outage isolation', () => {
  it('coalesces a Cron immediately after /check locally and still refreshes Download Center', async () => {
    const kv = new FakeKV(); const env = telegramEnv(kv); const fetcher = provider(); vi.stubGlobal('fetch', fetcher);
    await app.fetch(request(update('/check')), env);
    let pending: Promise<unknown> | undefined;
    scheduled({} as ScheduledController, env, { waitUntil: (value: Promise<unknown>) => { pending = value; } } as ExecutionContext);
    await pending;
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('knowledge/fetch'))).toHaveLength(1);
    expect(kv.writes.filter(({ key }) => key === REGISTRY_ALERT_KEY)).toHaveLength(1);
    expect(kv.writes.some(({ key }) => key === 'registry:download-center:resolved:v1')).toBe(true);
  });
  it('preserves the existing graceful scheduled behavior without Registry KV', async () => {
    let pending: Promise<unknown> | undefined;
    scheduled({} as ScheduledController, {}, { waitUntil: (value: Promise<unknown>) => { pending = value; } } as ExecutionContext);
    await expect(pending).resolves.toBeUndefined();
  });
  it('persists Registry and runs Download Center even when fault delivery times out', async () => {
    const kv = new FakeKV(); const env = telegramEnv(kv);
    const failure = health(start - 300_000, 'error'); failure.source = { status: 'error', code: 'CONTROL_PLANE_UPSTREAM_ERROR' };
    failure.modules.forEach((module) => { module.code = 'CONTROL_PLANE_UPSTREAM_ERROR'; });
    let alert = await createRegistryAlertState({ ...failure, checkedAt: start - 600_000 }, null);
    alert = await createRegistryAlertState(failure, alert);
    await persistRegistryAlertState(kv.binding(), alert); kv.reads.length = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('api.telegram.org')) return new Promise<Response>(() => {});
      return Response.json({}, { status: 500 });
    });
    vi.stubGlobal('fetch', fetcher);
    let pending: Promise<unknown> | undefined;
    scheduled({} as ScheduledController, env, { waitUntil: (value: Promise<unknown>) => { pending = value; } } as ExecutionContext);
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes('api.telegram.org'))).toBe(true));
    await vi.advanceTimersByTimeAsync(5000); await pending;
    expect((await loadRegistryHealth(kv.binding()))?.status).toBe('error');
    expect(kv.writes.some(({ key, value }) => key === 'registry:download-center:resolved:v1' && JSON.parse(value).schemaVersion === 2)).toBe(true);
    const stored = await loadRegistryAlertState(kv.binding());
    expect(stored?.delivery?.lastAttemptOutcome).toBe('failed'); expect(stored?.lastAlertAt).toBeUndefined();
  });
});
