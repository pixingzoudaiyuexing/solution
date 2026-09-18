function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (/\s/.test(text[index] ?? '')) index += 1;
  return index;
}

function scanString(text: string, start: number): { value: string; end: number } {
  let index = start + 1;
  let escaped = false;
  while (index < text.length) {
    const character = text[index];
    if (!escaped && character === '"') {
      const raw = text.slice(start, index + 1);
      return { value: JSON.parse(raw) as string, end: index + 1 };
    }
    if (!escaped && character === '\\') {
      escaped = true;
    } else {
      escaped = false;
    }
    index += 1;
  }
  throw new Error('Invalid Registry JSON');
}

function scanPrimitive(text: string, start: number): number {
  let index = start;
  while (index < text.length && !/[\s,\]}]/.test(text[index])) index += 1;
  return index;
}

function scanValue(text: string, start: number): number {
  let index = skipWhitespace(text, start);
  const character = text[index];
  if (character === '"') return scanString(text, index).end;
  if (character === '{') return scanObject(text, index);
  if (character === '[') return scanArray(text, index);
  return scanPrimitive(text, index);
}

function scanArray(text: string, start: number): number {
  let index = skipWhitespace(text, start + 1);
  if (text[index] === ']') return index + 1;
  while (index < text.length) {
    index = skipWhitespace(text, scanValue(text, index));
    if (text[index] === ']') return index + 1;
    if (text[index] !== ',') throw new Error('Invalid Registry JSON');
    index = skipWhitespace(text, index + 1);
  }
  throw new Error('Invalid Registry JSON');
}

function scanObject(text: string, start: number): number {
  const keys = new Set<string>();
  let index = skipWhitespace(text, start + 1);
  if (text[index] === '}') return index + 1;
  while (index < text.length) {
    if (text[index] !== '"') throw new Error('Invalid Registry JSON');
    const key = scanString(text, index);
    if (keys.has(key.value)) throw new Error('Invalid Registry JSON');
    keys.add(key.value);
    index = skipWhitespace(text, key.end);
    if (text[index] !== ':') throw new Error('Invalid Registry JSON');
    index = skipWhitespace(text, scanValue(text, index + 1));
    if (text[index] === '}') return index + 1;
    if (text[index] !== ',') throw new Error('Invalid Registry JSON');
    index = skipWhitespace(text, index + 1);
  }
  throw new Error('Invalid Registry JSON');
}

export function parseStrictJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  const end = skipWhitespace(text, scanValue(text, 0));
  if (end !== text.length) throw new Error('Invalid Registry JSON');
  return parsed;
}
