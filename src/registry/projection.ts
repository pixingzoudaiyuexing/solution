export function projectAllowlistedFields<
  Source extends Record<string, unknown>,
  Keys extends readonly (keyof Source)[],
>(source: Source, keys: Keys): Pick<Source, Keys[number]> {
  const projected = {} as Pick<Source, Keys[number]>;
  for (const key of keys) {
    projected[key] = source[key];
  }
  return projected;
}
