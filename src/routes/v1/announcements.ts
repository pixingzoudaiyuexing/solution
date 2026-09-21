import { Hono } from 'hono';
import { V2BoardAuthAdapter } from '../../adapters/v2board/auth';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import type { AnnouncementsSuccessResponse } from '../../contract/v1/announcements';
import { requestId } from '../../http/request-id';
import { registryOperationalDefinitions } from '../../registry/definitions';
import { announcementsOperationalDefinition } from '../../registry/modules/announcements';
import { readRegistryModuleSnapshot } from '../../registry/operational';
import { optionalAuthorization, type GatewayContext } from '../../security/authorization';

const announcementsRouter = new Hono<GatewayContext>();

function authAdapter(env: GatewayContext['Bindings']): V2BoardAuthAdapter {
  return new V2BoardAuthAdapter(createV2BoardClient(env));
}

announcementsRouter.get('/', async (c) => {
  const authToken = optionalAuthorization(c.req.header('Authorization'));
  if (authToken !== undefined) {
    await authAdapter(c.env).currentUser(authToken);
  }

  let items: AnnouncementsSuccessResponse['data']['items'] = [];
  if (c.env.REGISTRY_KV) {
    const result = await readRegistryModuleSnapshot(
      c.env.REGISTRY_KV,
      announcementsOperationalDefinition,
      Date.now(),
      registryOperationalDefinitions
    );
    if (result.status === 'available') {
      items = result.config.items
        .filter((item) => authToken !== undefined || item.visibility === 'public')
        .map(({ id, title, body }) => ({ id, title, body }));
    }
  }

  const response: AnnouncementsSuccessResponse = {
    ok: true,
    data: { items },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { announcementsRouter };
