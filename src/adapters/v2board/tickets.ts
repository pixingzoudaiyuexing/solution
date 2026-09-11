import { z } from 'zod';
import type {
  ClosedTicket,
  CreatedTicket,
  CreateTicketRequest,
  RepliedTicket,
  ReplyTicketRequest,
  TicketDetail,
  TicketPriority,
  TicketStatus,
  TicketSummary,
} from '../../contract/v1/tickets';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import {
  V2BoardTicketCloseError,
  V2BoardTicketCreateError,
  V2BoardTicketNotFoundError,
  V2BoardTicketReplyError,
  V2BoardTicketUnavailableError,
  V2BoardUpstreamError,
} from './errors';

const upstreamIdSchema = z.number().int().positive().max(2_147_483_647);
const timestampSchema = z.number().int().nonnegative().max(253_402_300_799);
const ticketLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const ticketStatusSchema = z.union([z.literal(0), z.literal(1)]);
const ticketSchema = z
  .object({
    id: upstreamIdSchema,
    subject: z.string().min(1).max(255),
    level: ticketLevelSchema,
    status: ticketStatusSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .strip();
const ticketMessageSchema = z
  .object({
    id: upstreamIdSchema,
    message: z.string().min(1).max(65_535),
    is_me: z.boolean(),
    created_at: timestampSchema,
  })
  .strip();
const ticketDetailSchema = ticketSchema
  .extend({ message: z.array(ticketMessageSchema) })
  .strip();
const ticketsResponseSchema = z.object({ data: z.array(ticketSchema) }).strip();
const ticketDetailResponseSchema = z.object({ data: ticketDetailSchema }).strip();
const mutationResponseSchema = z.object({ data: z.literal(true) }).strip();
const errorResponseSchema = z
  .object({ message: z.string().optional(), error: z.string().optional() })
  .strip();

const PRIORITY_MAP: Record<z.infer<typeof ticketLevelSchema>, TicketPriority> = {
  0: 'low',
  1: 'normal',
  2: 'high',
};
const LEVEL_MAP: Record<TicketPriority, z.infer<typeof ticketLevelSchema>> = {
  low: 0,
  normal: 1,
  high: 2,
};
const STATUS_MAP: Record<z.infer<typeof ticketStatusSchema>, TicketStatus> = {
  0: 'open',
  1: 'closed',
};

const TICKET_NOT_FOUND_MESSAGES = new Set([
  'ticket does not exist',
  '工单不存在',
]);
const TICKET_UNAVAILABLE_MESSAGES = new Set([
  'there are other unresolved tickets',
  '存在其它工单尚未处理',
  '请先购买套餐',
  '当前套餐不允许发起工单',
  '未知的工单状态',
]);
const TICKET_CREATE_FAILED_MESSAGES = new Set([
  'ticket subject cannot be empty',
  'ticket level cannot be empty',
  'incorrect ticket level format',
  'message cannot be empty',
]);
const TICKET_REPLY_FAILED_MESSAGES = new Set([
  'invalid parameter',
  '参数错误',
  'message cannot be empty',
  '消息不能为空',
  'the ticket is closed and cannot be replied',
  '工单已关闭，无法回复',
  'please wait for the technical enginneer to reply',
  '请等待技术支持回复',
  'ticket reply failed',
  '工单回复失败',
]);
const TICKET_CLOSE_FAILED_MESSAGES = new Set([
  'invalid parameter',
  '参数错误',
  'close failed',
  '关闭失败',
]);

function toIsoTimestamp(value: number): string {
  return new Date(value * 1000).toISOString();
}

function toPublicTicket(ticket: z.infer<typeof ticketSchema>): TicketSummary {
  return {
    id: String(ticket.id),
    subject: ticket.subject,
    priority: PRIORITY_MAP[ticket.level],
    status: STATUS_MAP[ticket.status],
    createdAt: toIsoTimestamp(ticket.created_at),
    updatedAt: toIsoTimestamp(ticket.updated_at),
  };
}

function errorMessage(payload: unknown): string | undefined {
  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  return (parsed.data.message ?? parsed.data.error)?.trim().toLowerCase();
}

export class V2BoardTicketsAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async tickets(authToken: string): Promise<TicketSummary[]> {
    const { response, payload } = await this.requestJson('user/ticket/fetch', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);

    const parsed = ticketsResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return parsed.data.data.map(toPublicTicket);
  }

  async ticket(authToken: string, id: string): Promise<TicketDetail> {
    const { response, payload } = await this.requestJson(
      `user/ticket/fetch?id=${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: authToken },
      }
    );
    this.assertAuthenticatedResponse(response);
    if (!response.ok) {
      const message = errorMessage(payload);
      if (response.status === 404 || (message && TICKET_NOT_FOUND_MESSAGES.has(message))) {
        throw new V2BoardTicketNotFoundError();
      }
      throw new V2BoardUpstreamError();
    }

    const parsed = ticketDetailResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    const ticket = parsed.data.data;
    return {
      ...toPublicTicket(ticket),
      messages: ticket.message.map((message) => ({
        id: String(message.id),
        content: message.message,
        fromMe: message.is_me,
        createdAt: toIsoTimestamp(message.created_at),
      })),
    };
  }

  async createTicket(
    authToken: string,
    request: CreateTicketRequest
  ): Promise<CreatedTicket> {
    const { response, payload } = await this.mutation('user/ticket/save', authToken, {
      subject: request.subject,
      level: LEVEL_MAP[request.priority],
      message: request.message,
    });
    if (!response.ok) {
      const message = errorMessage(payload);
      if (message && TICKET_UNAVAILABLE_MESSAGES.has(message)) {
        throw new V2BoardTicketUnavailableError();
      }
      if (message && TICKET_CREATE_FAILED_MESSAGES.has(message)) {
        throw new V2BoardTicketCreateError();
      }
      throw new V2BoardUpstreamError();
    }
    this.assertMutationSuccess(payload);
    return { created: true };
  }

  async replyTicket(
    authToken: string,
    id: string,
    request: ReplyTicketRequest
  ): Promise<RepliedTicket> {
    const { response, payload } = await this.mutation('user/ticket/reply', authToken, {
      id: Number(id),
      message: request.message,
    });
    if (!response.ok) {
      const message = errorMessage(payload);
      if (message && TICKET_NOT_FOUND_MESSAGES.has(message)) {
        throw new V2BoardTicketNotFoundError();
      }
      if (message && TICKET_REPLY_FAILED_MESSAGES.has(message)) {
        throw new V2BoardTicketReplyError();
      }
      throw new V2BoardUpstreamError();
    }
    this.assertMutationSuccess(payload);
    return { replied: true };
  }

  async closeTicket(authToken: string, id: string): Promise<ClosedTicket> {
    const { response, payload } = await this.mutation('user/ticket/close', authToken, {
      id: Number(id),
    });
    if (!response.ok) {
      const message = errorMessage(payload);
      if (message && TICKET_NOT_FOUND_MESSAGES.has(message)) {
        throw new V2BoardTicketNotFoundError();
      }
      if (message && TICKET_CLOSE_FAILED_MESSAGES.has(message)) {
        throw new V2BoardTicketCloseError();
      }
      throw new V2BoardUpstreamError();
    }
    this.assertMutationSuccess(payload);
    return { closed: true };
  }

  private async mutation(
    path: string,
    authToken: string,
    body: Record<string, unknown>
  ) {
    const result = await this.requestJson(path, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    this.assertAuthenticatedResponse(result.response);
    return result;
  }

  private assertMutationSuccess(payload: unknown): void {
    if (!mutationResponseSchema.safeParse(payload).success) {
      throw new V2BoardUpstreamError();
    }
  }
}
