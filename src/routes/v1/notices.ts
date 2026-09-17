import { Hono } from 'hono';
import { z } from 'zod';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardNoticesAdapter } from '../../adapters/v2board/notices';
import type { Env } from '../../config/env';
import { GatewayError } from '../../contract/error';
import type {
  CustomPagesSuccessResponse,
  NoticeDetailSuccessResponse,
  NoticePageRequest,
  NoticesSuccessResponse,
} from '../../contract/v1/notices';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const noticesRouter = new Hono<GatewayContext>();
const customPagesRouter = new Hono<GatewayContext>();
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
      .pipe(z.number().int().positive().max(100))
      .optional()
      .default('20'),
  })
  .strict();
const noticeIdSchema = positiveIntegerString.refine(
  (value) => Number(value) <= 2_147_483_647
);

function adapter(env: Env): V2BoardNoticesAdapter {
  return new V2BoardNoticesAdapter(createV2BoardClient(env));
}

function pagination(url: string): NoticePageRequest {
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

function noticeId(value: string): string {
  const parsed = noticeIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  return parsed.data;
}

noticesRouter.get('/', requireAuthorization, async (c) => {
  const data = await adapter(c.env).notices(
    c.get('authToken'),
    pagination(c.req.url)
  );
  const response: NoticesSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

noticesRouter.get('/:id', requireAuthorization, async (c) => {
  const data = await adapter(c.env).notice(
    c.get('authToken'),
    noticeId(c.req.param('id'))
  );
  const response: NoticeDetailSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

customPagesRouter.get('/', requireAuthorization, async (c) => {
  const items = await adapter(c.env).customPages(c.get('authToken'));
  const response: CustomPagesSuccessResponse = {
    ok: true,
    data: { items },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { customPagesRouter, noticesRouter };
