import { z } from 'zod';
import type {
  EmailCodeRequest,
  EmailCodeResponseData,
  LoginRequest,
  LoginResponseData,
  PasswordResetRequest,
  PasswordResetResponseData,
  RegisterRequest,
} from '../../contract/auth';
import type { CurrentUserResponseData } from '../../contract/user';
import { V2BoardClient } from './client';
import { V2BoardAdapterBase } from './base';
import {
  V2BoardAuthenticationError,
  V2BoardPasswordResetError,
  V2BoardRateLimitedError,
  V2BoardRegistrationUnavailableError,
  V2BoardUpstreamError,
  V2BoardValidationError,
  V2BoardVerificationError,
} from './errors';

const authDataSchema = z
  .object({ auth_data: z.string().min(1) })
  .strip();
const loginEnvelopeSchema = z
  .object({ data: authDataSchema })
  .strip();
const trueResponseSchema = z.object({ data: z.literal(true) }).strip();

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

const RATE_LIMIT_MESSAGES = new Set([
  'email verification code has been sent, please request again later',
  '验证码已发送，请过一会儿再请求',
  'reset failed, please try again later',
  '重置失败，请稍后再试',
]);
const VERIFICATION_MESSAGES = new Set([
  'incorrect email verification code',
  '邮箱验证码有误',
  'invalid code is incorrect',
  '验证码有误',
]);
const REGISTRATION_UNAVAILABLE_MESSAGES = new Set([
  'email already exists',
  '邮箱已在系统中存在',
  'this email is registered',
  '该邮箱已存在',
  'registration has closed',
  '本站已关闭注册',
  'you must use the invitation code to register',
  '必须使用邀请码才可以注册',
  'invalid invitation code',
  '邀请码无效',
  'email suffix is not in the whitelist',
  '邮箱后缀不处于白名单中',
  'gmail alias is not supported',
  '不支持 gmail 别名邮箱',
]);
const PASSWORD_RESET_MESSAGES = new Set([
  'this email is not registered in the system',
  '该邮箱不存在系统中',
  'reset failed',
]);

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

function authData(payload: unknown): z.infer<typeof authDataSchema> {
  const direct = authDataSchema.safeParse(payload);
  const envelope = loginEnvelopeSchema.safeParse(payload);
  if (direct.success) return direct.data;
  if (envelope.success) return envelope.data.data;
  throw new V2BoardUpstreamError();
}

function mappedRequest(
  required: Record<string, unknown>,
  optional: Record<string, string | undefined>
): Record<string, unknown> {
  return Object.fromEntries([
    ...Object.entries(required),
    ...Object.entries(optional).filter((entry): entry is [string, string] =>
      entry[1] !== undefined
    ),
  ]);
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
    const data = authData(payload);

    return {
      accessToken: data.auth_data,
      tokenType: 'Bearer',
    };
  }

  async sendEmailCode(request: EmailCodeRequest): Promise<EmailCodeResponseData> {
    const { response, payload } = await this.requestJson(
      'passport/comm/sendEmailVerify',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          mappedRequest(
            {
              email: request.email,
              isforget: request.purpose === 'register' ? 0 : 1,
            },
            { recaptcha_data: request.recaptchaData }
          )
        ),
      }
    );
    this.assertLifecycleResponse(response, payload, request.purpose);
    if (!trueResponseSchema.safeParse(payload).success) {
      throw new V2BoardUpstreamError();
    }
    return { sent: true };
  }

  async register(request: RegisterRequest): Promise<LoginResponseData> {
    const { response, payload } = await this.requestJson('passport/auth/register', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        mappedRequest(
          { email: request.email, password: request.password },
          {
            email_code: request.emailCode,
            invite_code: request.inviteCode,
            recaptcha_data: request.recaptchaData,
          }
        )
      ),
    });
    this.assertLifecycleResponse(response, payload, 'register');
    const data = authData(payload);
    return { accessToken: data.auth_data, tokenType: 'Bearer' };
  }

  async resetPassword(
    request: PasswordResetRequest
  ): Promise<PasswordResetResponseData> {
    const { response, payload } = await this.requestJson('passport/auth/forget', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: request.email,
        email_code: request.emailCode,
        password: request.newPassword,
      }),
    });
    this.assertLifecycleResponse(response, payload, 'password-reset');
    if (!trueResponseSchema.safeParse(payload).success) {
      throw new V2BoardUpstreamError();
    }
    return { reset: true };
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

  private assertLifecycleResponse(
    response: Response,
    payload: unknown,
    purpose: 'register' | 'password-reset'
  ): void {
    if (response.ok) return;
    if (response.status === 400 || response.status === 422) {
      throw new V2BoardValidationError();
    }
    if (response.status === 429) {
      throw new V2BoardRateLimitedError();
    }

    const message = authFailureMessage(payload)?.trim().toLowerCase();
    if (!message) throw new V2BoardUpstreamError();
    if (RATE_LIMIT_MESSAGES.has(message)) throw new V2BoardRateLimitedError();
    if (VERIFICATION_MESSAGES.has(message)) throw new V2BoardVerificationError();
    if (REGISTRATION_UNAVAILABLE_MESSAGES.has(message)) {
      throw new V2BoardRegistrationUnavailableError();
    }
    if (purpose === 'password-reset' && PASSWORD_RESET_MESSAGES.has(message)) {
      throw new V2BoardPasswordResetError();
    }
    throw new V2BoardUpstreamError();
  }
}
