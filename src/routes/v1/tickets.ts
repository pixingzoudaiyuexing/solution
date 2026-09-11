import { Hono } from 'hono';
import { z } from 'zod';
import { createV2BoardClient } from '../../adapters/v2board/factory';
import { V2BoardTicketsAdapter } from '../../adapters/v2board/tickets';
import type { Env } from '../../config/env';
import type {
  CloseTicketSuccessResponse,
  CreateTicketSuccessResponse,
  ReplyTicketSuccessResponse,
  TicketDetailSuccessResponse,
  TicketsSuccessResponse,
} from '../../contract/v1/tickets';
import { TICKET_PRIORITIES } from '../../contract/v1/tickets';
import { GatewayError } from '../../contract/error';
import { requestId } from '../../http/request-id';
import {
  requireAuthorization,
  type GatewayContext,
} from '../../security/authorization';

const ticketsRouter = new Hono<GatewayContext>();
const ticketIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .refine((value) => Number(value) <= 2_147_483_647);
const subjectSchema = z.string().min(1).max(255);
const messageSchema = z.string().min(1).max(10_000);
const createTicketSchema = z
  .object({
    subject: subjectSchema,
    priority: z.enum(TICKET_PRIORITIES),
    message: messageSchema,
  })
  .strict();
const replyTicketSchema = z.object({ message: messageSchema }).strict();

function ticketAdapter(env: Env): V2BoardTicketsAdapter {
  return new V2BoardTicketsAdapter(createV2BoardClient(env));
}

async function requestBody(
  c: Parameters<typeof requestId>[0]
): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
}

function ticketId(value: string): string {
  const parsed = ticketIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  return parsed.data;
}

ticketsRouter.get('/', requireAuthorization, async (c) => {
  const tickets = await ticketAdapter(c.env).tickets(c.get('authToken'));
  const response: TicketsSuccessResponse = {
    ok: true,
    data: { tickets },
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

ticketsRouter.post('/', requireAuthorization, async (c) => {
  const parsed = createTicketSchema.safeParse(await requestBody(c));
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const data = await ticketAdapter(c.env).createTicket(
    c.get('authToken'),
    parsed.data
  );
  const response: CreateTicketSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response, 201);
});

ticketsRouter.get('/:id', requireAuthorization, async (c) => {
  const data = await ticketAdapter(c.env).ticket(
    c.get('authToken'),
    ticketId(c.req.param('id'))
  );
  const response: TicketDetailSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

ticketsRouter.post('/:id/reply', requireAuthorization, async (c) => {
  const id = ticketId(c.req.param('id'));
  const parsed = replyTicketSchema.safeParse(await requestBody(c));
  if (!parsed.success) {
    throw new GatewayError(400, 'VALIDATION_ERROR', 'Invalid request');
  }
  const data = await ticketAdapter(c.env).replyTicket(
    c.get('authToken'),
    id,
    parsed.data
  );
  const response: ReplyTicketSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

ticketsRouter.post('/:id/close', requireAuthorization, async (c) => {
  const data = await ticketAdapter(c.env).closeTicket(
    c.get('authToken'),
    ticketId(c.req.param('id'))
  );
  const response: CloseTicketSuccessResponse = {
    ok: true,
    data,
    requestId: requestId(c),
  };
  c.header('Cache-Control', 'no-store');
  return c.json(response);
});

export { ticketsRouter };
