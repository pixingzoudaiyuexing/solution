import type { Env } from '../config/env';
import type { RegistryAlertState, RegistryOperationalHealth } from '../registry/operational';
import { sendTelegramMessage, telegramConfig } from './client';
import { formatRegistryHealth } from './messages';

export const ALERT_COOLDOWN_MS = 60 * 60_000;

export async function processTelegramAlert(
  env: Env, health: RegistryOperationalHealth, alert: RegistryAlertState,
  now = Date.now(), send = (text: string) => sendTelegramMessage(env, text)
): Promise<RegistryAlertState> {
  if (!telegramConfig(env)) return alert;
  const delivery = { ...alert.delivery, recentAlerts: (alert.delivery?.recentAlerts ?? [])
    .filter((entry) => now - entry.deliveredAt < ALERT_COOLDOWN_MS) };
  const failing = health.status === 'error' || health.status === 'degraded';
  if (failing) {
    if (alert.consecutiveFailures < 3 || delivery.recentAlerts.some((entry) => entry.fingerprint === alert.fingerprint) ||
        delivery.recentAlerts.length >= 16) return { ...alert, delivery };
  } else if (!alert.recoveryPending || !delivery.activeFingerprint) {
    return { ...alert, delivery };
  }
  let delivered = false;
  try { delivered = await send(`${failing ? '配置健康提醒' : '配置已恢复正常'}\n${formatRegistryHealth(health, now)}`); }
  catch { /* Generic delivery failure only; no provider error logging. */ }
  delivery.lastAttemptAt = now;
  delivery.lastAttemptOutcome = delivered ? 'delivered' : 'failed';
  if (!delivered) return { ...alert, delivery };
  if (failing) {
    delivery.activeFingerprint = alert.fingerprint;
    delivery.recentAlerts.push({ fingerprint: alert.fingerprint, deliveredAt: now });
    return { ...alert, lastAlertAt: now, delivery };
  }
  delete delivery.activeFingerprint;
  delivery.recoveryDeliveredAt = now;
  return { ...alert, recoveryPending: false, delivery };
}
