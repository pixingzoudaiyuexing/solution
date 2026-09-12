import { z } from 'zod';
import type { Wallet } from '../../contract/v1/wallet';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import { V2BoardUpstreamError } from './errors';

const walletResponseSchema = z
  .object({
    data: z
      .object({
        balance: z.number().int().nonnegative().max(2_147_483_647),
      })
      .strip(),
  })
  .strip();

export class V2BoardWalletAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async wallet(authToken: string): Promise<Wallet> {
    const { response, payload } = await this.requestJson('user/info', {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authToken },
    });
    this.assertAuthorizedResponse(response);

    const parsed = walletResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return { balanceMinor: parsed.data.data.balance };
  }
}
