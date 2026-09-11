import { Hono } from 'hono';
import { V2BoardTrafficAdapter } from '../../adapters/v2board/traffic';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import type { TrafficLogsSuccessResponse } from '../../contract/v1/traffic';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const trafficRouter = new Hono<GatewayContext>();

trafficRouter.get('/logs', requireAuthorization, async (c) => {
  const adapter = new V2BoardTrafficAdapter(createV2BoardClient(c.env));
  const entries = await adapter.logs(c.get('authToken'));
  const response: TrafficLogsSuccessResponse = {
    ok: true,
    data: { entries },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { trafficRouter };
