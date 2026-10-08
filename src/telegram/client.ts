import type { Env } from '../config/env';
import { readBoundedJson } from '../http/bounded-json';

export function telegramConfig(env: Env): { token: string; secret: string; owner: number } | null {
  if (!env.TELEGRAM_BOT_TOKEN || !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(env.TELEGRAM_BOT_TOKEN) ||
      !env.TELEGRAM_WEBHOOK_SECRET || !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET) ||
      !env.TELEGRAM_OWNER_USER_ID || !/^[1-9]\d{0,15}$/.test(env.TELEGRAM_OWNER_USER_ID)) return null;
  const owner = Number(env.TELEGRAM_OWNER_USER_ID);
  if (!Number.isSafeInteger(owner)) return null;
  return { token: env.TELEGRAM_BOT_TOKEN, secret: env.TELEGRAM_WEBHOOK_SECRET, owner };
}

// Never return provider errors or URLs: the Telegram URL necessarily contains the token.
export async function sendTelegramMessage(env: Env, text: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const config = telegramConfig(env);
  if (!config || text.length > 4000) return false;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(false); }, 5000);
  });
  const attempt = (async () => {
    try {
      const response = await fetcher(`https://api.telegram.org/bot${config.token}/sendMessage`, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.owner, text, link_preview_options: { is_disabled: true } }),
      });
      if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        void response.body?.cancel().catch(() => undefined);
        return false;
      }
      const value = await readBoundedJson(response, 16_384) as Record<string, unknown> | null;
      const result = value?.result as { message_id?: unknown; chat?: { id?: unknown } } | undefined;
      return value?.ok === true && Number.isSafeInteger(result?.message_id) && result?.chat?.id === config.owner;
    } catch { return false; }
  })();
  try { return await Promise.race([attempt, timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
