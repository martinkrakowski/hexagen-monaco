/**
 * Parse JSON with comments and trailing commas (what a `tsconfig.json` is),
 * without a dependency. Returns undefined when the text is not parseable.
 */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < n) {
    const c = text[i] as string;
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        if (text[j] === "\\") j++;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // Trailing commas: a comma followed only by whitespace and a closer.
  let cleaned = "";
  let inString = false;
  for (let k = 0; k < out.length; k++) {
    const c = out[k] as string;
    if (inString) {
      cleaned += c;
      if (c === "\\") {
        cleaned += out[++k] ?? "";
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      cleaned += c;
      continue;
    }
    if (c === ",") {
      let m = k + 1;
      while (m < out.length && /\s/.test(out[m] as string)) m++;
      if (out[m] === "}" || out[m] === "]") continue;
    }
    cleaned += c;
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
}
