/**
 * Convergence verdict parser (decided open question Q2).
 *
 * The critic's role prompt requires its reply to END with a line
 * `VERDICT: CONVERGED` or `VERDICT: CONTINUE`. Parsing is deliberately
 * forgiving (case-insensitive, trailing whitespace/markdown emphasis
 * tolerated, scanned from the last line upward) but the FALLBACK is strict:
 * a missing or malformed verdict is treated as CONTINUE (`explicit: false`)
 * so a model that forgets the contract can never silently end a session —
 * the round cap remains the backstop.
 */

export interface ParsedVerdict {
  readonly verdict: "converged" | "continue";
  /** false = no well-formed VERDICT line found; caller should log. */
  readonly explicit: boolean;
}

const VERDICT_LINE = /^\W*verdict\W*[:\-]\W*(converged|continue)\b/i;

export function parseVerdict(content: string): ParsedVerdict {
  const lines = content.split("\n");
  // Scan from the end: the verdict is contractually the LAST line, but models
  // sometimes append sign-off fluff; only the last few lines are considered so
  // an early "VERDICT: CONVERGED" quoted mid-critique can't end the session.
  const tail = lines.slice(-5);
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i].trim();
    if (!line) continue;
    const match = VERDICT_LINE.exec(line);
    if (match) {
      return {
        verdict: match[1].toLowerCase() as "converged" | "continue",
        explicit: true,
      };
    }
    // The last non-empty line is not a verdict — contract broken; stop looking
    // further up (an earlier mention would be quoted content, not a verdict).
    break;
  }
  return { verdict: "continue", explicit: false };
}
