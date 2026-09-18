export class FakeKV {
  readonly values = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: Array<{ key: string; value: string }> = [];
  readonly deletes: string[] = [];

  async get(key: string, type?: string | { type?: string }): Promise<unknown> {
    this.reads.push(key);
    const value = this.values.get(key) ?? null;
    const requestedType = typeof type === 'string' ? type : type?.type;
    if (value === null || requestedType === undefined || requestedType === 'text') {
      return value;
    }
    if (requestedType === 'json') return JSON.parse(value);
    if (requestedType === 'arrayBuffer') {
      return new TextEncoder().encode(value).buffer;
    }
    return new TextEncoder().encode(value).buffer;
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView): Promise<void> {
    const text =
      typeof value === 'string'
        ? value
        : new TextDecoder().decode(
            value instanceof ArrayBuffer
              ? new Uint8Array(value)
              : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          );
    this.values.set(key, text);
    this.writes.push({ key, value: text });
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.deletes.push(key);
  }

  clear(): void {
    this.values.clear();
  }

  binding(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}
