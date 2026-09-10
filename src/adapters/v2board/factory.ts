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
