import { Hono } from 'hono';
import { z } from 'zod';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardWalletAdapter } from '../../adapters/v2board/wallet';
import { GatewayError } from '../../contract/error';
import type {
  WalletDepositCreatedSuccessResponse,
  WalletSuccessResponse,
} from '../../contract/v1/wallet';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const walletRouter = new Hono<GatewayContext>();
const createDepositSchema = z
  .object({
    amountMinor: z.number().int().positive().max(2_147_483_647),
  })
  .strict();

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

walletRouter.post('/deposits', requireAuthorization, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const parsed = createDepositSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }

  const adapter = new V2BoardWalletAdapter(createV2BoardClient(c.env));
  const data = await adapter.createDeposit(
    c.get('authToken'),
    parsed.data.amountMinor
  );
  const response: WalletDepositCreatedSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response, 201);
});

export { walletRouter };
