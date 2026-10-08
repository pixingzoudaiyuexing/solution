import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTelegramMessage } from '../src/telegram/client';
import { telegramEnv, telegramSuccess, TEST_OWNER } from './helpers/telegram';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('bounded secret-safe Telegram delivery', () => {
  it('confirms provider success and targets only Telegram with manual redirects and no parse mode', async () => {
    const env = telegramEnv(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(telegramSuccess());
    expect(await sendTelegramMessage(env, '整体状态：正常', fetcher)).toBe(true);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`);
    expect(init?.redirect).toBe('manual'); expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual({ chat_id: TEST_OWNER, text: '整体状态：正常', link_preview_options: { is_disabled: true } });
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
  });
  it.each([
    () => Response.json({ ok: false, description: 'SECRET' }),
    () => Response.json({ ok: true }),
    () => Response.json({ ok: true, result: { message_id: 1, chat: { id: TEST_OWNER + 1 } } }),
    () => Response.json({ ok: true, result: { message_id: '1', chat: { id: TEST_OWNER } } }),
    () => new Response('invalid', { headers: { 'content-type': 'application/json' } }),
    () => new Response(' '.repeat(16_385), { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ ok: true }, { status: 302, headers: { location: 'https://untrusted.example' } }),
    () => new Response('SECRET', { status: 429 }),
  ])('never marks invalid, redirected or rejected response as delivered', async (response) => {
    expect(await sendTelegramMessage(telegramEnv(), '状态', vi.fn<typeof fetch>().mockResolvedValue(response()))).toBe(false);
  });
  it('isolates thrown provider errors without logging token-bearing errors', async () => {
    const logger = vi.spyOn(console, 'error'); const env = telegramEnv();
    expect(await sendTelegramMessage(env, '状态', vi.fn<typeof fetch>().mockRejectedValue(new Error(env.TELEGRAM_BOT_TOKEN)))).toBe(false);
    expect(logger).not.toHaveBeenCalled();
  });
  it('bounds both hung fetch and hung response body to five seconds', async () => {
    vi.useFakeTimers();
    for (const response of [undefined, new Response(new ReadableStream(), { headers: { 'content-type': 'application/json' } })]) {
      const fetcher = vi.fn<typeof fetch>(() => response ? Promise.resolve(response) : new Promise(() => {}));
      const pending = sendTelegramMessage(telegramEnv(), '状态', fetcher);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toBe(false); expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    }
    await vi.runAllTimersAsync();
  });
  it('fails closed for missing deployment settings or oversized output', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await sendTelegramMessage({}, '状态', fetcher)).toBe(false);
    expect(await sendTelegramMessage(telegramEnv(), '中'.repeat(4001), fetcher)).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
