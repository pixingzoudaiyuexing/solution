import { z } from 'zod';
import type { TrafficLogEntry } from '../../contract/v1/traffic';
import { V2BoardAdapterBase } from './base';
import { V2BoardClient } from './client';
import { V2BoardUpstreamError } from './errors';

const bytesSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const timestampSchema = z.number().int().nonnegative().max(253_402_300_799);
const rateMultiplierSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,7})\.\d{2}$/)
  .transform((value) => Number(value));
const trafficEntrySchema = z
  .object({
    u: bytesSchema,
    d: bytesSchema,
    record_at: timestampSchema,
    server_rate: rateMultiplierSchema,
  })
  .strip();
const trafficResponseSchema = z
  .object({ data: z.array(trafficEntrySchema) })
  .strip();

function toIsoTimestamp(value: number): string {
  return new Date(value * 1000).toISOString();
}

export class V2BoardTrafficAdapter extends V2BoardAdapterBase {
  constructor(client: V2BoardClient) {
    super(client);
  }

  async logs(authToken: string): Promise<TrafficLogEntry[]> {
    const { response, payload } = await this.requestJson(
      'user/stat/getTrafficLog',
      {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: authToken },
      }
    );
    this.assertAuthorizedResponse(response);

    const parsed = trafficResponseSchema.safeParse(payload);
    if (!parsed.success) throw new V2BoardUpstreamError();
    return parsed.data.data.map((entry) => ({
      uploadedBytes: entry.u,
      downloadedBytes: entry.d,
      recordedAt: toIsoTimestamp(entry.record_at),
      rateMultiplier: entry.server_rate,
    }));
  }
}
