import { describe, expect, it, vi } from 'vitest';
import { createRegistryAlertState, loadRegistryAlertState, persistRegistryAlertState, type RegistryAlertState } from '../src/registry/operational';
import { ALERT_COOLDOWN_MS, processTelegramAlert } from '../src/telegram/alerts';
import { FakeKV } from './helpers/fake-kv';
import { health, telegramEnv } from './helpers/telegram';

const start = 1_800_000_000_000;
async function faultStreak(count = 3) {
  let alert: RegistryAlertState | null = null;
  for (let n = 0; n < count; n++) alert = await createRegistryAlertState(health(start + n * 300_000, 'error'), alert);
  return alert!;
}

describe('Telegram Registry alert delivery', () => {
  it('does not alert until three observations of the same issue', async () => {
    const send = vi.fn().mockResolvedValue(true);
    for (const count of [1, 2]) await processTelegramAlert(telegramEnv(), health(start, 'error'), await faultStreak(count), start, send);
    expect(send).not.toHaveBeenCalled();
    const delivered = await processTelegramAlert(telegramEnv(), health(start, 'error'), await faultStreak(), start + 600_000, send);
    expect(send).toHaveBeenCalledOnce();
    expect(delivered.lastAlertAt).toBe(start + 600_000);
    expect(delivered.delivery?.activeFingerprint).toBe(delivered.fingerprint);
  });

  it('does not count repeated observation timestamps or module order as a new issue', async () => {
    const first = await faultStreak(1);
    const repeated = await createRegistryAlertState({ ...health(start, 'error'), modules: health(start, 'error').modules.reverse() }, first);
    expect(repeated.consecutiveFailures).toBe(1);
    expect(repeated.fingerprint).toBe(first.fingerprint);
  });

  it('enforces the exact 60 minute cooldown boundary', async () => {
    const send = vi.fn().mockResolvedValue(true);
    const alert = await processTelegramAlert(telegramEnv(), health(start, 'error'), await faultStreak(), start, send);
    await processTelegramAlert(telegramEnv(), health(start, 'error'), alert, start + ALERT_COOLDOWN_MS - 1, send);
    expect(send).toHaveBeenCalledOnce();
    await processTelegramAlert(telegramEnv(), health(start, 'error'), alert, start + ALERT_COOLDOWN_MS, send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('restarts the threshold for a genuinely different issue and retains previous issue cooldown', async () => {
    const env = telegramEnv();
    const send = vi.fn().mockResolvedValue(true);
    let alert = await processTelegramAlert(env, health(start, 'error'), await faultStreak(), start, send);
    const next = health(start + 300_000, 'error'); next.source = { status: 'error', code: 'CONTROL_PLANE_TIMEOUT' };
    for (let n = 1; n <= 3; n++) {
      next.checkedAt = start + n * 300_000;
      alert = await createRegistryAlertState(next, alert);
      expect(alert.consecutiveFailures).toBe(n);
      alert = await processTelegramAlert(env, next, alert, next.checkedAt, send);
      expect(send).toHaveBeenCalledTimes(n === 3 ? 2 : 1);
    }
    for (let n = 4; n <= 6; n++) {
      const original = health(start + n * 300_000, 'error');
      alert = await processTelegramAlert(env, original, await createRegistryAlertState(original, alert), original.checkedAt, send);
    }
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([false, 'throw'])('failed fault send (%s) never records delivery and retries next observation', async (failure) => {
    const send = vi.fn().mockImplementationOnce(() => failure === 'throw' ? Promise.reject(new Error('SECRET')) : Promise.resolve(false)).mockResolvedValue(true);
    let alert = await processTelegramAlert(telegramEnv(), health(start, 'error'), await faultStreak(), start, send);
    expect(alert.lastAlertAt).toBeUndefined();
    expect(alert.delivery?.activeFingerprint).toBeUndefined();
    expect(alert.delivery?.lastAttemptOutcome).toBe('failed');
    alert = await processTelegramAlert(telegramEnv(), health(start, 'error'), alert, start + 300_000, send);
    expect(alert.lastAlertAt).toBe(start + 300_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retains failed recovery pending across observations and delivers recovery exactly once locally', async () => {
    const send = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true);
    const env = telegramEnv();
    let alert = await processTelegramAlert(env, health(start, 'error'), await faultStreak(), start, send);
    const recovered = health(start + 900_000);
    alert = await createRegistryAlertState(recovered, alert);
    expect(alert.recoveryPending).toBe(true);
    alert = await processTelegramAlert(env, recovered, alert, recovered.checkedAt, send);
    expect(alert.recoveryPending).toBe(true);
    expect(alert.delivery?.recoveryDeliveredAt).toBeUndefined();
    recovered.checkedAt += 300_000;
    alert = await processTelegramAlert(env, recovered, await createRegistryAlertState(recovered, alert), recovered.checkedAt, send);
    expect(alert.recoveryPending).toBe(false);
    expect(send.mock.calls[2][0]).toContain('已恢复正常');
    recovered.checkedAt += 300_000;
    await processTelegramAlert(env, recovered, await createRegistryAlertState(recovered, alert), recovered.checkedAt, send);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not send recovery for a fault that was only observed', async () => {
    const observed = await faultStreak();
    const recovered = health(start + 900_000);
    const alert = await createRegistryAlertState(recovered, observed);
    const send = vi.fn();
    await processTelegramAlert(telegramEnv(), recovered, alert, recovered.checkedAt, send);
    expect(alert.recoveryPending).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it('migrates a legacy observed-only pending recovery without inventing a delivered incident', async () => {
    const legacy = await faultStreak(); legacy.recoveryPending = true;
    const recovered = health(start + 900_000);
    const migrated = await createRegistryAlertState(recovered, legacy);
    expect(migrated.recoveryPending).toBe(false);
    const send = vi.fn();
    await processTelegramAlert(telegramEnv(), recovered, migrated, recovered.checkedAt, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('round trips legacy and extended alert state without storing Telegram identities', async () => {
    const kv = new FakeKV();
    const legacy = await faultStreak();
    await persistRegistryAlertState(kv.binding(), legacy);
    expect(await loadRegistryAlertState(kv.binding())).toEqual(legacy);
    const env = telegramEnv(kv);
    const extended = await processTelegramAlert(env, health(start, 'error'), legacy, start, async () => true);
    await persistRegistryAlertState(kv.binding(), extended);
    expect(await loadRegistryAlertState(kv.binding())).toEqual(extended);
    const stored = [...kv.values.values()].join('');
    for (const secret of [env.TELEGRAM_BOT_TOKEN!, env.TELEGRAM_OWNER_USER_ID!, env.TELEGRAM_WEBHOOK_SECRET!]) expect(stored).not.toContain(secret);
  });

  it('bounds fault cooldown history without evicting still-cooled issues', async () => {
    const alert = await faultStreak();
    alert.delivery = { recentAlerts: Array.from({ length: 16 }, (_, n) => ({ fingerprint: n.toString(16).padStart(64, '0'), deliveredAt: start })) };
    const send = vi.fn();
    await processTelegramAlert(telegramEnv(), health(start, 'error'), alert, start + 1, send);
    expect(send).not.toHaveBeenCalled();
  });
});
