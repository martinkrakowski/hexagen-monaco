function countBracesAndBrackets(
  str: string,
): { bracesOpen: number; bracesClose: number; bracketsOpen: number; bracketsClose: number } {
  let bracesOpen = 0;
  let bracesClose = 0;
  let bracketsOpen = 0;
  let bracketsClose = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
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
    if (char === "{") {
      bracesOpen++;
    } else if (char === "}") {
      bracesClose++;
    } else if (char === "[") {
      bracketsOpen++;
    } else if (char === "]") {
      bracketsClose++;
    }
  }

  return { bracesOpen, bracesClose, bracketsOpen, bracketsClose };
}

export function countBraces(str: string): { open: number; close: number } {
  const counts = countBracesAndBrackets(str);
  return { open: counts.bracesOpen, close: counts.bracesClose };
}

export function countBrackets(str: string): { open: number; close: number } {
  const counts = countBracesAndBrackets(str);
  return { open: counts.bracketsOpen, close: counts.bracketsClose };
}

export function balanceJSON(json: string): string {
  const counts = countBracesAndBrackets(json);

  let result = json;
  const missingBraces = counts.bracesOpen - counts.bracesClose;
  const missingBrackets = counts.bracketsOpen - counts.bracketsClose;

  if (missingBraces > 0) {
    result += "}".repeat(missingBraces);
  }
  if (missingBrackets > 0) {
    result += "]".repeat(missingBrackets);
  }

  return result;
}
