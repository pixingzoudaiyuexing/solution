import type { Env } from '../config/env';
import { refreshRegistryOperationalState, type RegistryRefreshOptions } from '../registry/refresh';
import { loadRegistryHealth, type RegistryOperationalHealth } from '../registry/operational';
import { processTelegramAlert } from './alerts';

// Serialization is isolate-local. KV has neither CAS nor globally linearizable locks.
const operations = new WeakMap<KVNamespace, Promise<unknown>>();
const completedAt = new WeakMap<KVNamespace, number>();

export async function withRegistryOperation<T>(kv: KVNamespace | undefined, action: () => Promise<T>): Promise<T> {
  if (!kv) return action();
  const previous = operations.get(kv);
  const running = (async () => { await previous?.catch(() => undefined); return action(); })();
  operations.set(kv, running);
  try { return await running; }
  finally { if (operations.get(kv) === running) operations.delete(kv); }
}

export async function refreshRegistryWithTelegram(env: Env, command?: { fingerprint: string; sequence: number }, options: RegistryRefreshOptions = {}): Promise<RegistryOperationalHealth | null> {
  const now = options.now ?? Date.now;
  const kv = env.REGISTRY_KV;
  // Avoid back-to-back same-key writes when Cron follows a manual check locally.
  if (kv && now() - (completedAt.get(kv) ?? -Infinity) < 1000) return loadRegistryHealth(kv);
  let current: RegistryOperationalHealth | null = null;
  const result = await refreshRegistryOperationalState(env, {
    ...options,
    processAlert: async (health, alert) => {
      current = health;
      const delivered = await processTelegramAlert(env, health, alert, (options.now ?? Date.now)());
      if (command) {
        delivered.delivery = {
          ...delivered.delivery, recentAlerts: delivered.delivery?.recentAlerts ?? [],
          lastCheck: { updateFingerprint: command.fingerprint, updateSequence: command.sequence, checkedAt: health.checkedAt },
        };
      }
      return delivered;
    },
  });
  if (kv) completedAt.set(kv, now());
  if (!result.ok && result.code === 'KV_UNAVAILABLE') return null;
  return current ?? (env.REGISTRY_KV ? loadRegistryHealth(env.REGISTRY_KV) : null);
}
