import type { Env } from '../../src/config/env';
import type { RegistryOperationalHealth } from '../../src/registry/operational';
import { FakeKV } from './fake-kv';

export const TEST_OWNER = 123456789;
export const TEST_SECRET = 'synthetic_webhook_secret_12345678901234567890';
export function telegramEnv(kv = new FakeKV()): Env {
  return {
    REGISTRY_KV: kv.binding(), TELEGRAM_BOT_TOKEN: '123456:SYNTHETIC_TOKEN_12345678901234567890',
    TELEGRAM_OWNER_USER_ID: String(TEST_OWNER), TELEGRAM_WEBHOOK_SECRET: TEST_SECRET,
    V2BOARD_BASE_URL: 'https://panel.example/api/v1/',
    V2BOARD_CONTROL_ADMIN_PREFIX: 'admin', V2BOARD_CONTROL_AUTH_DATA: 'SYNTHETIC_ADMIN_SECRET',
  };
}
export function health(checkedAt = 1_800_000_000_000, status: RegistryOperationalHealth['status'] = 'ok'): RegistryOperationalHealth {
  return {
    schemaVersion: 1, status, checkedAt, source: { status: 'ok' },
    modules: ['runtime-settings', 'custom-pages', 'subscription-delivery', 'subscription-profile', 'announcements', 'download-center', 'navigation']
      .map((moduleId) => ({ moduleId, status, checkedAt, consecutiveFailures: status === 'error' ? 1 : 0,
        ...(status === 'error' || status === 'degraded' ? { code: 'INVALID_SCHEMA' as const } : {}) })),
  };
}
export function update(text = '/health', sequence = 100) {
  return { update_id: sequence, message: { from: { id: TEST_OWNER, is_bot: false }, chat: { id: TEST_OWNER, type: 'private' }, text } };
}
export function telegramSuccess() {
  return Response.json({ ok: true, result: { message_id: 1, chat: { id: TEST_OWNER } } });
}
