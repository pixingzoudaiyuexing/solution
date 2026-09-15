export function validatedHttpsRequestOrigin(
  value: string | undefined
): string | undefined {
  if (value === undefined) return undefined;

  try {
    const origin = new URL(value);
    return origin.protocol === 'https:' && origin.origin === value
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
