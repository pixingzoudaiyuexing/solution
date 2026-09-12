import { Hono } from 'hono';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardWalletAdapter } from '../../adapters/v2board/wallet';
import type { WalletSuccessResponse } from '../../contract/v1/wallet';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const walletRouter = new Hono<GatewayContext>();

walletRouter.get('/', requireAuthorization, async (c) => {
  const adapter = new V2BoardWalletAdapter(createV2BoardClient(c.env));
  const data = await adapter.wallet(c.get('authToken'));
  const response: WalletSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { walletRouter };
