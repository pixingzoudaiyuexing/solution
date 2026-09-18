import { z } from 'zod';
import type { Env } from '../../config/env';
import { cancelUnusedResponseBody } from '../../http/response-body';
import {
  REGISTRY_CATEGORY,
  type RegistryKnowledgeRecord,
} from '../../registry/kernel';
import {
  RegistrySecretError,
  SensitiveSecret,
  resolveControlPlaneBootstrapSecret,
} from '../../registry/secrets';
import {
  UpstreamTimeoutError,
  V2BoardClient,
} from './client';

export enum ControlPlaneErrorCode {
  CONTROL_PLANE_AUTH_INVALID = 'CONTROL_PLANE_AUTH_INVALID',
  CONTROL_PLANE_CONFIG_INVALID = 'CONTROL_PLANE_CONFIG_INVALID',
  CONTROL_PLANE_TIMEOUT = 'CONTROL_PLANE_TIMEOUT',
  CONTROL_PLANE_UPSTREAM_ERROR = 'CONTROL_PLANE_UPSTREAM_ERROR',
}

const CONTROL_PLANE_MESSAGES: Record<ControlPlaneErrorCode, string> = {
  [ControlPlaneErrorCode.CONTROL_PLANE_AUTH_INVALID]:
    'Control Plane authentication is unavailable',
  [ControlPlaneErrorCode.CONTROL_PLANE_CONFIG_INVALID]:
    'Control Plane configuration is invalid',
  [ControlPlaneErrorCode.CONTROL_PLANE_TIMEOUT]:
    'Control Plane request timed out',
  [ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR]:
    'Control Plane source could not be read',
};

export class ControlPlaneError extends Error {
  constructor(readonly code: ControlPlaneErrorCode) {
    super(CONTROL_PLANE_MESSAGES[code]);
    this.name = 'ControlPlaneError';
  }

  toJSON(): { code: ControlPlaneErrorCode } {
    return { code: this.code };
  }
}

const timestampSchema = z.number().int().nonnegative().max(253_402_300_799);
const showSchema = z.union([z.literal(0), z.literal(1)]);
const listItemSchema = z
  .object({
    id: z.number().int().positive().max(2_147_483_647),
    title: z.string().max(255),
    category: z.string().max(255),
    show: showSchema,
    updated_at: timestampSchema,
  })
  .strip();
const listResponseSchema = z
  .object({ data: z.array(listItemSchema) })
  .strip();
const detailSchema = listItemSchema
  .extend({ body: z.string().max(1_048_576) })
  .strip();
const detailResponseSchema = z.object({ data: detailSchema }).strip();

function validateAdminPrefix(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('%') ||
    /^[a-z][a-z\d+.-]*:/i.test(value) ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value)
  ) {
    throw new ControlPlaneError(
      ControlPlaneErrorCode.CONTROL_PLANE_CONFIG_INVALID
    );
  }
  return value;
}

export class V2BoardControlPlaneClient {
  #client: V2BoardClient;
  #authData: SensitiveSecret;
  #adminPrefix: string;

  private constructor(
    client: V2BoardClient,
    authData: SensitiveSecret,
    adminPrefix: string
  ) {
    this.#client = client;
    this.#authData = authData;
    this.#adminPrefix = adminPrefix;
  }

  static fromEnv(
    env: Env,
    fetcher: typeof fetch = fetch
  ): V2BoardControlPlaneClient {
    if (!env.V2BOARD_BASE_URL) {
      throw new ControlPlaneError(
        ControlPlaneErrorCode.CONTROL_PLANE_CONFIG_INVALID
      );
    }

    let authData: SensitiveSecret;
    try {
      authData = resolveControlPlaneBootstrapSecret(
        env.V2BOARD_CONTROL_AUTH_DATA
      );
    } catch (error) {
      if (error instanceof RegistrySecretError) {
        throw new ControlPlaneError(
          ControlPlaneErrorCode.CONTROL_PLANE_AUTH_INVALID
        );
      }
      throw error;
    }

    const adminPrefix = validateAdminPrefix(
      env.V2BOARD_CONTROL_ADMIN_PREFIX
    );
    let client: V2BoardClient;
    try {
      client = new V2BoardClient(
        {
          baseUrl: env.V2BOARD_BASE_URL,
          accessClientId: env.V2BOARD_ACCESS_CLIENT_ID,
          accessClientSecret: env.V2BOARD_ACCESS_CLIENT_SECRET,
        },
        fetcher
      );
    } catch {
      throw new ControlPlaneError(
        ControlPlaneErrorCode.CONTROL_PLANE_CONFIG_INVALID
      );
    }
    return new V2BoardControlPlaneClient(client, authData, adminPrefix);
  }

  async readRegistryKnowledgeSource(): Promise<RegistryKnowledgeRecord[]> {
    const list = await this.#readKnowledgeList();
    const seenIds = new Set<number>();
    const source: RegistryKnowledgeRecord[] = [];

    for (const item of list) {
      if (seenIds.has(item.id)) {
        throw new ControlPlaneError(
          ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR
        );
      }
      seenIds.add(item.id);
      if (item.category !== REGISTRY_CATEGORY) continue;

      if (item.show === 0) {
        source.push({
          sourceId: item.id,
          title: item.title,
          category: item.category,
          show: 0,
          updatedAt: item.updated_at,
        });
        continue;
      }

      const detail = await this.#readKnowledgeDetail(item.id);
      if (
        detail.id !== item.id ||
        detail.title !== item.title ||
        detail.category !== item.category ||
        detail.show !== item.show ||
        detail.updated_at !== item.updated_at
      ) {
        throw new ControlPlaneError(
          ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR
        );
      }
      source.push({
        sourceId: detail.id,
        title: detail.title,
        category: detail.category,
        show: 1,
        updatedAt: detail.updated_at,
        body: detail.body,
      });
    }

    return source;
  }

  async #readKnowledgeList(): Promise<z.infer<typeof listItemSchema>[]> {
    const payload = await this.#readJson(
      `${this.#adminPrefix}/knowledge/fetch`
    );
    const parsed = listResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ControlPlaneError(
        ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR
      );
    }
    return parsed.data.data;
  }

  async #readKnowledgeDetail(
    id: number
  ): Promise<z.infer<typeof detailSchema>> {
    const query = new URLSearchParams({ id: String(id) });
    const payload = await this.#readJson(
      `${this.#adminPrefix}/knowledge/fetch?${query.toString()}`
    );
    const parsed = detailResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ControlPlaneError(
        ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR
      );
    }
    return parsed.data.data;
  }

  async #readJson(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#client.fetch(path, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: this.#authData.consume(),
        },
      });
    } catch (error) {
      if (
        error instanceof UpstreamTimeoutError ||
        (error instanceof DOMException &&
          (error.name === 'AbortError' || error.name === 'TimeoutError'))
      ) {
        throw new ControlPlaneError(
          ControlPlaneErrorCode.CONTROL_PLANE_TIMEOUT
        );
      }
      throw new ControlPlaneError(
        ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR
      );
    }

    if (response.status === 401 || response.status === 403) {
      await cancelUnusedResponseBody(response);
      throw new ControlPlaneError(
        ControlPlaneErrorCode.CONTROL_PLANE_AUTH_INVALID
      );
    }
    if (!response.ok) {
      await cancelUnusedResponseBody(response);
      throw new ControlPlaneError(
        ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR
      );
    }

    try {
      return await response.json();
    } catch {
      throw new ControlPlaneError(
        ControlPlaneErrorCode.CONTROL_PLANE_UPSTREAM_ERROR
      );
    }
  }
}

export function createV2BoardControlPlaneClient(
  env: Env,
  fetcher: typeof fetch = fetch
): V2BoardControlPlaneClient {
  return V2BoardControlPlaneClient.fromEnv(env, fetcher);
}
