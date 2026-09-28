import { Hono } from 'hono';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardAuthAdapter } from '../../adapters/v2board/auth';
import type { NavigationSuccessResponse } from '../../contract/v1/navigation';
import { requestId } from '../../http/request-id';
import { registryOperationalDefinitions } from '../../registry/definitions';
import { customPagesOperationalDefinition } from '../../registry/modules/custom-pages';
import { navigationOperationalDefinition } from '../../registry/modules/navigation';
import { readRegistryModuleSnapshot } from '../../registry/operational';
import { resolveNavigation } from '../../security/navigation';
import { requireAuthorization, type GatewayContext } from '../../security/authorization';

const navigationRouter = new Hono<GatewayContext>();

navigationRouter.get('/', requireAuthorization, async (c) => {
  await new V2BoardAuthAdapter(createV2BoardClient(c.env)).currentUser(c.get('authToken'));
  let navigation = null;
  let custom = null;
  if (c.env.REGISTRY_KV) {
    try {
      const navResult = await readRegistryModuleSnapshot(c.env.REGISTRY_KV, navigationOperationalDefinition, Date.now(), registryOperationalDefinitions);
      if (navResult.status === 'available') navigation = navResult.config;
    } catch { /* Registry presentation failure uses compiled fallback. */ }
    try {
      const customResult = await readRegistryModuleSnapshot(c.env.REGISTRY_KV, customPagesOperationalDefinition, Date.now(), registryOperationalDefinitions);
      if (customResult.status === 'available') custom = customResult.config;
    } catch { /* Core navigation remains available. */ }
  }
  const response: NavigationSuccessResponse = { ok: true, data: { items: resolveNavigation(navigation, custom) }, requestId: requestId(c) };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { navigationRouter };
