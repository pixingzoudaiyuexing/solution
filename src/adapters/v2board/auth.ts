import { z } from 'zod';
import type { LoginRequest, LoginResponseData } from '../../contract/auth';
import type { CurrentUserResponseData } from '../../contract/user';
import { V2BoardClient } from './client';
import { V2BoardAdapterBase } from './base';
import {
  V2BoardAuthenticationError,
  V2BoardUpstreamError,
  V2BoardValidationError,
} from './errors';

const authDataSchema = z
  .object({ auth_data: z.string().min(1) })
  .strip();
const loginEnvelopeSchema = z
  .object({ data: authDataSchema })
  .strip();

const bannedSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((value) => value === true || value === 1);

const userDataSchema = z
  .object({
    email: z.string().email(),
    expired_at: z.number().int().nonnegative().max(253402300799).nullable(),
    banned: bannedSchema,
  })
  .strip();
const userEnvelopeSchema = z
  .object({ data: userDataSchema })
  .strip();

const errorResponseSchema = z
  .object({
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .strip();

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
  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }

  return [parsed.data.message, parsed.data.error].find(
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

function accountStatus(
  banned: boolean,
  expiredAt: number | null
): CurrentUserResponseData['status'] {
  if (banned) {
    return 'disabled';
  }
  if (expiredAt !== null && expiredAt <= Math.floor(Date.now() / 1000)) {
    return 'expired';
  }
  return 'active';
}

export class V2BoardAuthAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async login(request: LoginRequest): Promise<LoginResponseData> {
    const { response, payload } = await this.requestJson('passport/auth/login', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    this.assertAuthenticationResponse(response, payload);
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
    const { response, payload } = await this.requestJson('user/info', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: authToken,
      },
    });
    this.assertAuthorizedResponse(response);
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

    return {
      email: data.email,
      expiresAt:
        data.expired_at === null
          ? null
          : new Date(data.expired_at * 1000).toISOString(),
      status: accountStatus(data.banned, data.expired_at),
    };
  }

  private assertAuthenticationResponse(
    response: Response,
    payload: unknown
  ): void {
    if (response.ok) {
      return;
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
