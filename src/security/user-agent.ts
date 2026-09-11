export const MAX_TRUSTED_USER_AGENT_BYTES = 512;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const NON_BYTE_STRING_CHARACTER = /[^\u0000-\u00ff]/;

export function validateTrustedUserAgent(value: string): string {
  if (
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > MAX_TRUSTED_USER_AGENT_BYTES ||
    CONTROL_CHARACTERS.test(value) ||
    NON_BYTE_STRING_CHARACTER.test(value)
  ) {
    throw new Error('Invalid trusted User-Agent');
  }

  return value;
}
