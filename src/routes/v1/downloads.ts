import { Hono } from 'hono';
import type { DownloadsSuccessResponse } from '../../contract/v1/downloads';
import { requestId } from '../../http/request-id';
import { readAvailableDownloads } from '../../registry/download-center-resolved';
import type { GatewayContext } from '../../security/authorization';

const downloadsRouter = new Hono<GatewayContext>();

downloadsRouter.get('/', async (c) => {
  const items = c.env.REGISTRY_KV
    ? await readAvailableDownloads(c.env.REGISTRY_KV, Date.now())
    : [];
  const response: DownloadsSuccessResponse = {
    ok: true,
    data: { items },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { downloadsRouter };
