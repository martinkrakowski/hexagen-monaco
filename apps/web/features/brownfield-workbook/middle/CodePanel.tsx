import { cleanText, cleanTextKeepingCrlf } from "@hexagen/shared";
import { crlfCount, type CodeFile } from "./derive";

/**
 * The file is the truth: slice.json, contract.json and each grant are shown as
 * the bundle's decoded text, never re-serialised, in a plain `<pre>` with no
 * highlighting markup. The only transformation is `cleanText`.
 */

export interface CodePanelProps {
  readonly files: readonly CodeFile[];
  readonly selected: string | null;
  readonly onSelect: (path: string) => void;
}

export function CodePanel({ files, selected, onSelect }: CodePanelProps) {
  const current = files.find((f) => f.path === selected) ?? files[0];
  return (
    <section
      aria-label="Code"
      data-testid="code-panel"
      className="rounded border p-3"
    >
      <h2 className="text-lg font-semibold">Code</h2>
      {current === undefined ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No slice, contract or grant is in this bundle.
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {files.map((f) => (
              <button
                key={f.path}
                type="button"
                aria-pressed={f.path === current.path}
                onClick={() => onSelect(f.path)}
                className="rounded border px-2 text-xs"
              >
                {cleanText(f.path)}
              </button>
            ))}
          </div>
          {crlfCount(current.text) > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {crlfCount(current.text)} CRLF line endings
            </p>
          )}
          <pre
            data-testid="code-text"
            className="mt-2 overflow-x-auto whitespace-pre p-2 text-xs"
          >
            {cleanTextKeepingCrlf(current.text)}
          </pre>
        </>
      )}
    </section>
  );
}
