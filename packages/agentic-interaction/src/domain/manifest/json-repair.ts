import { balanceJSON } from "./json-balancer";

function fixUnclosedStrings(json: string): string {
  let inString = false;
  let escaped = false;
  const chars: string[] = [];

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) {
      chars.push(ch);
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      chars.push(ch);
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      chars.push(ch);
      continue;
    }
    chars.push(ch);
  }

  if (inString) {
    chars.push('"');
  }

  return chars.join("");
}

export function repairJSON(raw: string): string | null {
  let s = raw.trim();

  s = s.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");

  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1F\x7F]/g, (c) =>
    c === "\n" || c === "\r" || c === "\t" ? c : "",
  );

  // Fix unclosed strings first
  s = fixUnclosedStrings(s);

  // First attempt: balance the entire cleaned string
  let balanced = balanceJSON(s);
  if (balanced) {
    try {
      JSON.parse(balanced);
      return balanced;
    } catch {
      // Continue to next attempt
    }
  }

  // Second attempt: extract first JSON block, then balance
  const block = extractFirstJSONBlock(s);
  if (block) {
    const fixedBlock = fixUnclosedStrings(block);
    balanced = balanceJSON(fixedBlock);
    if (balanced) {
      try {
        JSON.parse(balanced);
        return balanced;
      } catch {
        // Continue
      }
    }
  }

  // All attempts failed
  return null;
}

export function extractFirstJSONBlock(s: string): string | null {
  const start = s.search(/[{[]/);
  if (start === -1) return null;

  const openChar = s[start];
  const closeChar = openChar === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0 && ch === closeChar) return s.slice(start, i + 1);
    }
  }

  return s.slice(start);
}
