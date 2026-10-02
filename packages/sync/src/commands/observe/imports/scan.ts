/**
 * A small lexical scanner for JS/TS module specifiers. It is a tokenizer, not
 * a parser: it knows comments, strings, template literals (with nested
 * `${...}`), regex literals and a few keywords, and nothing else. It never
 * builds a syntax tree and never touches the TypeScript compiler API.
 *
 * Known limits, accepted for a bounded pass: JSX text containing an
 * apostrophe can open a string that is closed at the end of the line, and a
 * regex literal after `)` is read as division. Both can only lose or invent
 * a specifier on the line concerned; neither can run past it.
 */

export interface ScannedSpecifier {
  /** The literal specifier, or null when the specifier is not a plain string. */
  readonly specifier: string | null;
  readonly kind: "import" | "export-from" | "dynamic-import" | "require";
}

type Tok =
  | { k: "id"; v: string; inTpl: boolean }
  | { k: "str"; v: string; escaped: boolean; inTpl: boolean }
  | { k: "opaque"; inTpl: boolean }
  | { k: "p"; v: string; inTpl: boolean };

const ID_START = /[\p{L}\p{Nl}$_#\\]/u;
const ID_PART = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_\\‌‍]/u;

/** Keywords after which a `/` starts a regex rather than a division. */
const REGEX_AFTER_KEYWORD: ReadonlySet<string> = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

function regexAllowedAfter(prev: Tok | undefined): boolean {
  if (!prev) return true;
  if (prev.k === "str" || prev.k === "opaque") return false;
  if (prev.k === "id") return REGEX_AFTER_KEYWORD.has(prev.v);
  return prev.v !== ")" && prev.v !== "]";
}

/** Pass 1: text to tokens. Comments are dropped; template contents are opaque. */
export function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  // One entry per open `{`: true when it opened a template `${`.
  const braces: boolean[] = [];
  let depth = 0; // open template `${` count
  let i = 0;
  const n = text.length;
  if (text.startsWith("#!")) {
    while (i < n && text[i] !== "\n") i++;
  }

  /** Read a template body from `i`. Returns true when the template closed. */
  const templateBody = (): boolean => {
    while (i < n) {
      const c = text[i] as string;
      if (c === "\\") {
        i += 2;
      } else if (c === "`") {
        i++;
        return true;
      } else if (c === "$" && text[i + 1] === "{") {
        i += 2;
        braces.push(true);
        depth++;
        return false;
      } else {
        i++;
      }
    }
    return true;
  };

  while (i < n) {
    const c = text[i] as string;
    const inTpl = depth > 0;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let escaped = false;
      while (j < n && text[j] !== c && text[j] !== "\n") {
        if (text[j] === "\\") {
          escaped = true;
          j++;
        }
        j++;
      }
      const end = Math.min(j, n);
      toks.push({ k: "str", v: text.slice(i + 1, end), escaped, inTpl });
      i = text[end] === c ? end + 1 : end;
    } else if (c === "`") {
      i++;
      if (templateBody()) toks.push({ k: "opaque", inTpl });
    } else if (c === "}" && braces[braces.length - 1] === true) {
      braces.pop();
      depth--;
      i++;
      if (templateBody()) toks.push({ k: "opaque", inTpl: depth > 0 });
    } else if (c === "/" && regexAllowedAfter(toks[toks.length - 1])) {
      // A regex literal; if it does not close on this line, it is a division.
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && text[j] !== "\n") {
        const d = text[j] as string;
        if (d === "\\") j++;
        else if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        i = j + 1;
        while (i < n && ID_PART.test(text[i] as string)) i++;
        toks.push({ k: "opaque", inTpl });
      } else {
        i++;
        toks.push({ k: "p", v: "/", inTpl });
      }
    } else if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_PART.test(text[j] as string)) j++;
      toks.push({ k: "id", v: text.slice(i, j), inTpl });
      i = j;
    } else if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && /[0-9a-zA-Z_.]/.test(text[j] as string)) j++;
      toks.push({ k: "opaque", inTpl });
      i = j;
    } else {
      if (c === "{") braces.push(false);
      else if (c === "}") braces.pop();
      toks.push({ k: "p", v: c, inTpl });
      i++;
    }
  }
  return toks;
}

const isP = (t: Tok | undefined, v: string): boolean =>
  t?.k === "p" && t.v === v;
const isId = (t: Tok | undefined, v: string): boolean =>
  t?.k === "id" && t.v === v;

/**
 * Scan `text` and return every module specifier found outside comments and
 * template literals, in source order.
 */
export function scanSpecifiers(text: string): ScannedSpecifier[] {
  const toks = tokenize(text);
  const out: ScannedSpecifier[] = [];
  // Set by `import` / `export` until the statement's `from 'x'` or a `;`.
  let fromKind: ScannedSpecifier["kind"] | null = null;
  const literal = (t: Tok | undefined): string | null =>
    t?.k === "str" && !t.escaped && t.v.length > 0 ? t.v : null;

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i] as Tok;
    if (t.inTpl) continue;
    if (isP(t, ";")) {
      fromKind = null;
      continue;
    }
    if (t.k === "str") {
      // `from 'x'`, only inside an import or export statement.
      if (fromKind && isId(toks[i - 1], "from")) {
        out.push({ specifier: literal(t), kind: fromKind });
        fromKind = null;
      }
      continue;
    }
    if (t.k !== "id") continue;
    const dotted = isP(toks[i - 1], ".");
    if (dotted) continue;
    const next = toks[i + 1];
    if (t.v === "import" || t.v === "export") {
      if (t.v === "import" && next?.k === "str") {
        // import 'x'
        out.push({ specifier: literal(next), kind: "import" });
        i++;
      } else if (!isP(next, "(")) {
        fromKind = t.v === "import" ? "import" : "export-from";
      }
    }
    if (
      (t.v === "import" || t.v === "require") &&
      isP(next, "(") &&
      !isId(toks[i - 1], "function")
    ) {
      const arg = toks[i + 2];
      const after = toks[i + 3];
      const plain =
        literal(arg) !== null && (isP(after, ")") || isP(after, ","));
      out.push({
        specifier: plain ? literal(arg) : null,
        kind: t.v === "import" ? "dynamic-import" : "require",
      });
    }
  }
  return out;
}
