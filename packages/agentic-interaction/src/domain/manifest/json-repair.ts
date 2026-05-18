import { balanceJSON } from "./json-balancer.js";

export function repairJSON(raw: string): string | null {
  let s = raw.trim();

  s = s.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");

  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1F\x7F]/g, (c) =>
    c === "\n" || c === "\r" || c === "\t" ? c : "",
  );

  s = fixUnterminatedStrings(s);
  s = fixMultilineUnterminatedString(s);

  let depth = 0;
  let lastValidClose = -1;
  let started = false;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < s.length; i++) {
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
    if (ch === "{" || ch === "[") {
      depth++;
      started = true;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      if (started && depth === 0) lastValidClose = i;
    }
  }

  const startIdx = s.search(/[{[]/);
  if (startIdx !== -1 && lastValidClose > 0 && lastValidClose >= startIdx) {
    s = s.slice(startIdx, lastValidClose + 1);
  } else if (startIdx !== -1) {
    s = s.slice(startIdx);
    s = balanceJSON(s);
  } else if (lastValidClose > 0) {
    s = s.slice(0, lastValidClose + 1);
    s = balanceJSON(s);
  }

  try {
    JSON.parse(s);
    return s;
  } catch {
    return null;
  }
}

function countQuotesIgnoreEscaped(line: string): { total: number; endsWithOpenQuote: boolean } {
  let count = 0;
  let inString = false;
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      count++;
    }
  }

  return { total: count, endsWithOpenQuote: inString };
}

function fixUnterminatedStrings(json: string): string {
  const lines = json.split("\n");
  const fixedLines: string[] = [];

  for (const line of lines) {
    const { total: quotes, endsWithOpenQuote } = countQuotesIgnoreEscaped(line);
    if (quotes % 2 !== 0 || endsWithOpenQuote) {
      const firstOpenQuote = line.indexOf('"');
      if (firstOpenQuote > 0) {
        fixedLines.push(line.substring(0, firstOpenQuote));
      }
    } else {
      fixedLines.push(line);
    }
  }

  const result = fixedLines.join("\n");

  if (result !== json) {
    return balanceJSON(result);
  }

  return json;
}

function fixMultilineUnterminatedString(json: string): string {
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
      escaped = true;
      chars.push(ch);
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      chars.push(ch);
      continue;
    }

    if (inString) {
      chars.push(ch);
      continue;
    }

    chars.push(ch);
  }

  let result = chars.join("");

  if (inString) {
    result = balanceJSON(result);
  }

  return result;
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

  return null;
}
