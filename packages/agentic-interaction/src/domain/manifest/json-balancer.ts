function countBracesAndBrackets(str: string): {
  bracesOpen: number;
  bracesClose: number;
  bracketsOpen: number;
  bracketsClose: number;
} {
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

function getUnclosedDelimiters(json: string): string[] {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
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

    if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}" || char === "]") {
      const expectedOpen = char === "}" ? "{" : "[";
      // Find the matching open delimiter in the stack (search from top)
      let foundIndex = -1;
      for (let j = stack.length - 1; j >= 0; j--) {
        if (stack[j] === expectedOpen) {
          foundIndex = j;
          break;
        }
      }
      if (foundIndex !== -1) {
        // Remove all delimiters from foundIndex to the end (they are being closed)
        stack.splice(foundIndex);
      }
      // If no match found, this closing delimiter is extraneous; ignore it
    }
  }

  return stack;
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
  const unclosed = getUnclosedDelimiters(json);
  const closings = unclosed
    .reverse()
    .map((d) => (d === "{" ? "}" : "]"))
    .join("");
  return json + closings;
}
