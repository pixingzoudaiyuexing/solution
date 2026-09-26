import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { fetchAppleAutoAccounts } from '../../adapters/appleauto/shared-page';
import { V2BoardAuthAdapter } from '../../adapters/v2board/auth';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { GatewayError, publicErrorResponse } from '../../contract/error';
import type {
  AppleIdRevealSuccessResponse,
  AppleIdsSuccessResponse,
} from '../../contract/v1/apple-ids';
import { requestId } from '../../http/request-id';
import { requireAuthorization, type GatewayContext } from '../../security/authorization';

const appleIdsRouter = new Hono<GatewayContext>();
const revealSchema = z.object({ username: z.string().min(1).max(512) }).strict();

async function verifyUser(c: Context<GatewayContext>): Promise<void> {
  await new V2BoardAuthAdapter(createV2BoardClient(c.env)).currentUser(c.get('authToken'));
}

appleIdsRouter.get('/', requireAuthorization, async (c) => {
  await verifyUser(c);
  const accounts = await fetchAppleAutoAccounts();
  const response: AppleIdsSuccessResponse = {
    ok: true,
    data: {
      items: accounts.map(({ username, status, lastCheck, remark }) => ({
        username,
        status,
        lastCheck,
        remark,
      })),
    },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

appleIdsRouter.post('/reveal', requireAuthorization, async (c) => {
  await verifyUser(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const parsed = revealSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }

  const accounts = await fetchAppleAutoAccounts();
  const matches = accounts.filter((account) => account.username === parsed.data.username);
  if (matches.length !== 1) {
    c.header('Cache-Control', 'no-store');
    return c.json(
      publicErrorResponse('APPLE_ID_ACCOUNT_UNAVAILABLE', 'Apple ID account unavailable', requestId(c)),
      409
    );
  }

  const response: AppleIdRevealSuccessResponse = {
    ok: true,
    data: matches[0],
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { appleIdsRouter };
