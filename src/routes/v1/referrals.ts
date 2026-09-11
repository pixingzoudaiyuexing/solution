import { Hono } from 'hono';
import { z } from 'zod';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardReferralsAdapter } from '../../adapters/v2board/referrals';
import type { Env } from '../../config/env';
import { GatewayError } from '../../contract/error';
import type {
  CommissionHistorySuccessResponse,
  CommissionPageRequest,
  CreateReferralCodeSuccessResponse,
  ReferralOverviewSuccessResponse,
} from '../../contract/v1/referrals';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const referralsRouter = new Hono<GatewayContext>();
const positiveIntegerString = z.string().regex(/^[1-9]\d*$/);
const paginationSchema = z
  .object({
    page: positiveIntegerString
      .transform(Number)
      .pipe(z.number().int().positive().max(2_147_483_647))
      .optional()
      .default('1'),
    pageSize: positiveIntegerString
      .transform(Number)
      .pipe(z.number().int().min(10).max(100))
      .optional()
      .default('20'),
  })
  .strict();

function adapter(env: Env): V2BoardReferralsAdapter {
  return new V2BoardReferralsAdapter(createV2BoardClient(env));
}

function pagination(url: string): CommissionPageRequest {
  const entries = [...new URL(url).searchParams.entries()];
  const keys = new Set(entries.map(([key]) => key));
  if (keys.size !== entries.length) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const parsed = paginationSchema.safeParse(Object.fromEntries(entries));
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  return parsed.data;
}

referralsRouter.get('/', requireAuthorization, async (c) => {
  const data = await adapter(c.env).overview(c.get('authToken'));
  const response: ReferralOverviewSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

referralsRouter.post('/codes', requireAuthorization, async (c) => {
  const data = await adapter(c.env).createCode(c.get('authToken'));
  const response: CreateReferralCodeSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response, 201);
});

referralsRouter.get('/commissions', requireAuthorization, async (c) => {
  const data = await adapter(c.env).commissions(
    c.get('authToken'),
    pagination(c.req.url)
  );
  const response: CommissionHistorySuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { referralsRouter };
