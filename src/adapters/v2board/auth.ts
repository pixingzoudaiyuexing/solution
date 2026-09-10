import { z } from 'zod';
import type { LoginRequest, LoginResponseData } from '../../contract/auth';
import type { CurrentUserResponseData } from '../../contract/user';
import { V2BoardClient } from './client';
import {
  V2BoardAuthenticationError,
  V2BoardUpstreamError,
  V2BoardValidationError,
} from './errors';

const authDataSchema = z
  .object({ auth_data: z.string().min(1) })
  .passthrough();
const loginEnvelopeSchema = z
  .object({ data: authDataSchema })
  .passthrough();

const userDataSchema = z
  .object({ email: z.string().email() })
  .passthrough();
const userEnvelopeSchema = z
  .object({ data: userDataSchema })
  .passthrough();

// V2Board reports these authentication failures with HTTP 500.
const AUTH_FAILURE_MESSAGES = new Set([
  'incorrect email or password',
  'invalid credential',
  'invalid token',
  'user disabled',
  'your account has been suspended',
  'expired session',
  '邮箱或密码错误',
  '该账户已被停止使用',
]);
const AUTH_FAILURE_PREFIXES = [
  'there are too many password errors',
  '密码错误次数过多',
];

function authFailureMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  return [record.message, record.error].find(
    (value): value is string => typeof value === 'string'
  );
}

function isAuthenticationFailure(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    AUTH_FAILURE_MESSAGES.has(normalized) ||
    AUTH_FAILURE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

export class V2BoardAuthAdapter {
  constructor(private readonly client: V2BoardClient) {}

  async login(request: LoginRequest): Promise<LoginResponseData> {
    const payload = await this.requestJson('passport/auth/login', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    const direct = authDataSchema.safeParse(payload);
    const envelope = loginEnvelopeSchema.safeParse(payload);
    let data: z.infer<typeof authDataSchema>;
    if (direct.success) {
      data = direct.data;
    } else if (envelope.success) {
      data = envelope.data.data;
    } else {
      throw new V2BoardUpstreamError();
    }

    return {
      accessToken: data.auth_data,
      tokenType: 'Bearer',
    };
  }

  async currentUser(authToken: string): Promise<CurrentUserResponseData> {
    const payload = await this.requestJson('user/info', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
      },
    });
    const direct = userDataSchema.safeParse(payload);
    const envelope = userEnvelopeSchema.safeParse(payload);
    let data: z.infer<typeof userDataSchema>;
    if (direct.success) {
      data = direct.data;
    } else if (envelope.success) {
      data = envelope.data.data;
    } else {
      throw new V2BoardUpstreamError();
    }

    return { email: data.email };
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;

    try {
      response = await this.client.fetch(path, init);
    } catch {
      throw new V2BoardUpstreamError();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new V2BoardUpstreamError();
    }

    if (response.ok) {
      return payload;
    }

    if (response.status === 400 || response.status === 422) {
      throw new V2BoardValidationError();
    }

    if (response.status === 401 || response.status === 403) {
      throw new V2BoardAuthenticationError();
    }

    const message = authFailureMessage(payload);
    if (message && isAuthenticationFailure(message)) {
      throw new V2BoardAuthenticationError();
    }

    throw new V2BoardUpstreamError();
  }
}
