export function countBraces(str: string): { open: number; close: number } {
  let open = 0;
  let close = 0;
  let inString = false;
  let escaped = false;

  for (const char of str) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") open++;
    if (char === "}") close++;
  }

  return { open, close };
}

export function countBrackets(str: string): { open: number; close: number } {
  let open = 0;
  let close = 0;
  let inString = false;
  let escaped = false;

  for (const char of str) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "[") open++;
    if (char === "]") close++;
  }

  return { open, close };
}

export function balanceJSON(json: string): string {
  let result = json;

  const braces = countBraces(json);
  if (braces.open > braces.close) {
    result += "}".repeat(braces.open - braces.close);
  }

  const brackets = countBrackets(result);
  if (brackets.open > brackets.close) {
    result += "]".repeat(brackets.open - brackets.close);
  }

  return result;
}
