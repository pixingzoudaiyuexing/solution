export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid bounded response');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    await response.body.cancel().catch(() => undefined);
    throw new Error('Oversized response');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let expired = false;
  const timeout = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, 10_000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Oversized response');
      chunks.push(value);
    }
    if (expired) throw new Error('Timed out response');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    void reader.cancel().catch(() => undefined);
    throw new Error('Invalid bounded response');
  } finally {
    clearTimeout(timeout);
  }
}
