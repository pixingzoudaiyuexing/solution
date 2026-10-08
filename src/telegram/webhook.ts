import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../config/env';
import { readBoundedJson } from '../http/bounded-json';
import { loadRegistryAlertState, loadRegistryHealth } from '../registry/operational';
import { sendTelegramMessage, telegramConfig } from './client';
import { commandHelp, formatRegistryHealth } from './messages';
import { refreshRegistryWithTelegram, withRegistryOperation } from './operations';

const id = z.number().int().nonnegative().safe();
const ownerMessage = z.object({
  update_id: id,
  message: z.object({
    from: z.object({ id, is_bot: z.literal(false) }),
    chat: z.object({ id, type: z.literal('private') }),
    text: z.string().max(4096),
  }),
});

// Bounded transient retry cache. No identities, message bodies or credentials retained.
const retries = new WeakMap<KVNamespace, Map<string, { at: number; result: Promise<boolean> }>>();

async function updateFingerprint(value: number): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`telegram-update:${value}`));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function runCommand(env: Env, command: string, key: string, sequence: number): Promise<boolean> {
  const kv = env.REGISTRY_KV;
  if (command === '/health') return sendTelegramMessage(env, formatRegistryHealth(kv ? await loadRegistryHealth(kv) : null));
  if (command !== '/check') return sendTelegramMessage(env, commandHelp);
  return withRegistryOperation(kv, async () => {
    const previous = kv ? await loadRegistryAlertState(kv) : null;
    const check = previous?.delivery?.lastCheck;
    // Telegram retries retain update_id. Older deliveries cannot trigger another refresh.
    // A week without updates may randomize Telegram's next ID, so expire the watermark.
    const duplicate = check && Date.now() - check.checkedAt < 7 * 86_400_000 &&
      (check.updateFingerprint === key || (check.updateSequence !== undefined && sequence <= check.updateSequence));
    if (previous && !duplicate && Date.now() - previous.lastCheckedAt < 30_000) {
      return sendTelegramMessage(env, '刚刚已经检查过，请稍后再发送 /check。可发送 /health 查看状态。');
    }
    try {
      const health = duplicate
        ? kv ? await loadRegistryHealth(kv) : null
        : await refreshRegistryWithTelegram(env, { fingerprint: key, sequence });
      return sendTelegramMessage(env, health ? formatRegistryHealth(health) : '本次检查暂时未完成，请稍后发送 /health 查看状态。');
    } catch {
      return sendTelegramMessage(env, '本次检查暂时未完成，请稍后发送 /health 查看状态。');
    }
  });
}

export const telegramRouter = new Hono<{ Bindings: Env }>();
telegramRouter.all('/webhook', async (c) => {
  if (c.req.method !== 'POST') return c.body(null, 405, { Allow: 'POST' });
  const config = telegramConfig(c.env);
  if (!config || c.req.header('X-Telegram-Bot-Api-Secret-Token') !== config.secret) return c.body(null, 403);
  if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) return c.body(null, 415);
  let update: z.infer<typeof ownerMessage>;
  try {
    const parsed = ownerMessage.safeParse(await readBoundedJson(new Response(c.req.raw.body, { headers: c.req.raw.headers }), 16_384));
    if (!parsed.success) return c.body(null, 200);
    update = parsed.data;
  } catch { return c.body(null, 400); }
  if (update.message.from.id !== config.owner || update.message.chat.id !== config.owner) return c.body(null, 200);
  const key = await updateFingerprint(update.update_id);
  const kv = c.env.REGISTRY_KV;
  const now = Date.now();
  let cache = kv ? retries.get(kv) : undefined;
  if (!cache && kv) { cache = new Map(); retries.set(kv, cache); }
  for (const [hash, entry] of cache ?? []) if (now - entry.at >= 86_400_000) cache!.delete(hash);
  let result = cache?.get(key)?.result;
  if (!result) {
    if (cache && cache.size >= 128) cache.delete(cache.keys().next().value!);
    result = runCommand(c.env, update.message.text, key, update.update_id);
    cache?.set(key, { at: now, result });
  }
  const delivered = await result;
  if (!delivered) cache?.delete(key);
  return c.body(null, delivered ? 200 : 503);
});
