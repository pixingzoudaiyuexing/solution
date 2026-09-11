export const TICKET_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketStatus = 'open' | 'closed';

export interface TicketSummary {
  id: string;
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  content: string;
  fromMe: boolean;
  createdAt: string;
}

export interface TicketDetail extends TicketSummary {
  messages: TicketMessage[];
}

export interface CreateTicketRequest {
  subject: string;
  priority: TicketPriority;
  message: string;
}

export interface ReplyTicketRequest {
  message: string;
}

export interface CreatedTicket {
  created: true;
}

export interface RepliedTicket {
  replied: true;
}

export interface ClosedTicket {
  closed: true;
}

export interface TicketsSuccessResponse {
  ok: true;
  data: { tickets: TicketSummary[] };
  requestId: string;
}

export interface TicketDetailSuccessResponse {
  ok: true;
  data: TicketDetail;
  requestId: string;
}

export interface CreateTicketSuccessResponse {
  ok: true;
  data: CreatedTicket;
  requestId: string;
}

export interface ReplyTicketSuccessResponse {
  ok: true;
  data: RepliedTicket;
  requestId: string;
}

export interface CloseTicketSuccessResponse {
  ok: true;
  data: ClosedTicket;
  requestId: string;
}
