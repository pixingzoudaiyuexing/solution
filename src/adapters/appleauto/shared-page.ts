import { z } from 'zod';
import type { AppleIdAccount } from '../../contract/v1/apple-ids';

const SHARED_PAGE_URL = 'http://id.8babao.com/shareapi/id';
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 512 * 1024;

const accountSchema = z.object({
  username: z.string().min(1),
  password: z.string(),
  status: z.boolean(),
  last_check: z.string(),
  frontend_remark: z.string().nullish(),
});
const successSchema = z.object({
  status: z.literal(true),
  msg: z.string(),
  accounts: z.array(accountSchema),
});
const failureSchema = z.object({
  status: z.literal(false),
  msg: z.string(),
});

export type AppleAutoErrorCode =
  | 'TIMEOUT'
  | 'UNREACHABLE'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_FAILURE';

export class AppleAutoError extends Error {
  constructor(readonly code: AppleAutoErrorCode) {
    super('AppleAuto Shared Page unavailable');
    this.name = 'AppleAutoError';
  }
}

export interface AppleAutoAccount extends AppleIdAccount {
  password: string;
}

export async function fetchAppleAutoAccounts(): Promise<AppleAutoAccount[]> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new AppleAutoError('TIMEOUT'));
    }, TIMEOUT_MS);
  });

  let response: Response;
  try {
    response = await Promise.race([
      fetch(SHARED_PAGE_URL, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }),
      timeoutPromise,
    ]);
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new AppleAutoError('HTTP_ERROR');
    }

    const payload = await Promise.race([readPayload(response), timeoutPromise]);
    if (failureSchema.safeParse(payload).success) {
      throw new AppleAutoError('PROVIDER_FAILURE');
    }
    const parsed = successSchema.safeParse(payload);
    if (!parsed.success) throw new AppleAutoError('INVALID_RESPONSE');

    return parsed.data.accounts.map((account) => ({
      username: account.username,
      password: account.password,
      status: account.status,
      lastCheck: account.last_check,
      remark: account.frontend_remark || null,
    }));
  } catch (error) {
    if (error instanceof AppleAutoError) throw error;
    throw new AppleAutoError(controller.signal.aborted ? 'TIMEOUT' : 'UNREACHABLE');
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new AppleAutoError('INVALID_RESPONSE');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new AppleAutoError('INVALID_RESPONSE');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new AppleAutoError('INVALID_RESPONSE');
  }
}
