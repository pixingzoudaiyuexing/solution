import type { Env } from '../../config/env';
import { V2BoardClient } from './client';

export function createV2BoardClient(env: Env): V2BoardClient {
  if (!env.V2BOARD_BASE_URL) {
    throw new Error('V2Board is not configured');
  }

  return new V2BoardClient({
    baseUrl: env.V2BOARD_BASE_URL,
    accessClientId: env.V2BOARD_ACCESS_CLIENT_ID,
    accessClientSecret: env.V2BOARD_ACCESS_CLIENT_SECRET,
  });
}

export function createV2BoardOriginClient(env: Env): V2BoardClient {
  if (!env.V2BOARD_BASE_URL) {
    throw new Error('V2Board is not configured');
  }

  const baseUrl = new URL(env.V2BOARD_BASE_URL);
  baseUrl.pathname = '/';
  baseUrl.search = '';
  baseUrl.hash = '';

  return new V2BoardClient({
    baseUrl: baseUrl.toString(),
    accessClientId: env.V2BOARD_ACCESS_CLIENT_ID,
    accessClientSecret: env.V2BOARD_ACCESS_CLIENT_SECRET,
  });
}
