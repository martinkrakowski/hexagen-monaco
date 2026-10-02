import { cleanText } from "@hexagen/shared";
import type { LoadedBundle } from "../bundle/read-bundle";
import { CopyCommandButton } from "../CopyCommandButton";
import {
  deriveRightPanel,
  type DenialView,
  type GrantView,
  type ProposalView,
} from "./derive";

/**
 * The right panel (BW9): the agent under the grant, as a VIEWER (BW-D2, BW-D9).
 * It shows what the bundle recorded and nothing else. It has no form, no text
 * box and no control that calls a tool; the only buttons copy a CLI command.
 * Every string from the bundle goes through `cleanText` and is rendered as
 * React text, never as HTML.
 */

const safe = (text: string): string => cleanText(text);

export const LOCAL_MCP_NOTICE =
  "The agent runs locally under MCP. This page only shows what the bundle recorded.";

const SAFE_PATCH_PATH = /^proposals\/[A-Za-z0-9._-]+\.patch$/;

function List({ items }: { readonly items: readonly string[] }) {
  if (items.length === 0) return <span>none</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {items.map((t, i) => (
        <li key={i} className="rounded bg-muted px-2 py-1 font-mono text-xs">
          {safe(t)}
        </li>
      ))}
    </ul>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </div>
  );
}

function Grant({
  grant,
  active,
  bundleTime,
}: {
  readonly grant: GrantView;
  readonly active: boolean;
  readonly bundleTime: string;
}) {
  return (
    <li
      data-testid={`grant-${safe(grant.id)}`}
      className="rounded-lg border p-3"
    >
      <p className="font-medium">
        grant {safe(grant.id)}
        {active && (
          <span className="ml-2 rounded bg-muted px-2 py-1 text-xs">
            active
          </span>
        )}
      </p>
      <dl className="mt-2 space-y-2 text-sm">
        <Row label="principal">
          {grant.principal === null ? "not recorded" : safe(grant.principal)}
        </Row>
        <Row label="agent">
          {grant.agent === null ? "not recorded" : safe(grant.agent)}
        </Row>
        <Row label="mode">
          {grant.mode === null ? "not recorded" : safe(grant.mode)}
        </Row>
        <Row label="tools">
          <List items={grant.tools} />
        </Row>
        <Row label="paths">
          <List items={grant.paths} />
        </Row>
        <Row label="expires">
          {grant.expiresAt === null ? (
            "not recorded"
          ) : (
            <>
              {safe(grant.expiresAt)}
              {grant.expiredAtBundle && (
                <span className="ml-2 font-medium">
                  expired at bundle time ({safe(bundleTime)})
                </span>
              )}
            </>
          )}
        </Row>
        {grant.revokedAt !== null && (
          <Row label="revoked">
            {safe(grant.revokedAt)}
            {grant.revokedAtBundle && (
              <span className="ml-2 font-medium">
                revoked at bundle time ({safe(bundleTime)})
              </span>
            )}
          </Row>
        )}
      </dl>
    </li>
  );
}

function Diff({ proposal }: { readonly proposal: ProposalView }) {
  return (
    <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-2 text-xs">
      {proposal.lines.map((l, i) => (
        <span
          key={i}
          className={
            l.kind === "add"
              ? "text-emerald-700 dark:text-emerald-400"
              : l.kind === "del"
                ? "text-destructive"
                : undefined
          }
        >
          {safe(l.text)}
          {i < proposal.lines.length - 1 ? "\n" : ""}
        </span>
      ))}
    </pre>
  );
}

function Proposal({
  proposal,
  ordinal,
}: {
  readonly proposal: ProposalView;
  readonly ordinal: number;
}) {
  const { decoded, meta } = proposal;
  return (
    <li
      data-testid={`proposal-${safe(proposal.id)}`}
      className="rounded-lg border p-3"
    >
      <p className="font-medium break-all">{safe(proposal.path)}</p>
      {meta !== null && (
        <dl className="mt-2 space-y-2 text-sm">
          <Row label="grant">{safe(meta.grantId)}</Row>
          <Row label="tool">{safe(meta.tool)}</Row>
          <Row label="files">
            <List items={meta.paths} />
          </Row>
          <Row label="created">{safe(meta.createdAt)}</Row>
        </dl>
      )}
      {decoded.replaced && (
        <p role="note" className="mt-2 text-sm font-medium">
          not valid UTF-8; shown with replacement characters
        </p>
      )}
      {decoded.truncated && (
        <p role="note" className="mt-2 text-sm font-medium">
          truncated: showing the first {decoded.shownBytes.toLocaleString()} of{" "}
          {decoded.totalBytes.toLocaleString()} bytes
        </p>
      )}
      <Diff proposal={proposal} />
      {SAFE_PATCH_PATH.test(proposal.path) && (
        <p className="mt-2 text-xs">
          <code>{`git apply -p1 .hexagen/${proposal.path}`}</code>{" "}
          <CopyCommandButton
            stepLabel="proposal"
            ordinal={ordinal}
            command={`git apply -p1 .hexagen/${proposal.path}`}
          />
        </p>
      )}
    </li>
  );
}

function Denial({ denial }: { readonly denial: DenialView }) {
  return (
    <li
      data-code={denial.code}
      className="break-all rounded border border-destructive p-2 text-sm"
    >
      <span className="font-medium">{denial.code}</span> #{denial.seq}
      {" / "}
      {denial.tool === null ? "tool not recorded" : safe(denial.tool)}
      {" / "}
      {denial.reason === null ? "no reason recorded" : safe(denial.reason)}
    </li>
  );
}

export function RightPanel({ bundle }: { readonly bundle: LoadedBundle }) {
  const v = deriveRightPanel(bundle);
  const shownGrants = [...v.grants].sort(
    (a, b) =>
      Number(b.id === v.activeGrantId) - Number(a.id === v.activeGrantId),
  );
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">The agent under the grant</h2>
      <p role="note" className="text-sm font-medium">
        {LOCAL_MCP_NOTICE}
      </p>

      <section aria-label="Grant" className="space-y-2">
        <h3 className="font-medium">Grant</h3>
        {v.slice !== null && (
          <p className="text-sm break-all">
            bounded by slice {safe(v.slice.id)}:{" "}
            {v.slice.paths.map(safe).join(", ") || "no paths"}
            {v.slice.excludes.length > 0 &&
              `; excluding ${v.slice.excludes.map(safe).join(", ")}`}
          </p>
        )}
        {v.activeNote !== null && (
          <p role="note" className="text-sm">
            {v.activeNote}
          </p>
        )}
        {v.grants.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No grant in this bundle.
          </p>
        )}
        <ul className="space-y-2">
          {shownGrants.map((g) => (
            <Grant
              key={g.file}
              grant={g}
              active={g.id === v.activeGrantId}
              bundleTime={v.bundleTime}
            />
          ))}
        </ul>
        {v.unreadableGrants.map((f) => (
          <p key={f} className="text-sm">
            {safe(f)} could not be read as a grant.
          </p>
        ))}
      </section>

      <section aria-label="Proposals" className="space-y-2">
        <h3 className="font-medium">Proposals</h3>
        {v.proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No proposals in this bundle.
          </p>
        ) : (
          <ul className="space-y-2">
            {v.proposals.map((p, i) => (
              <Proposal key={p.path} proposal={p} ordinal={i + 1} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Denials" className="space-y-2">
        <h3 className="font-medium">Denials</h3>
        <p className="text-xs text-muted-foreground">
          The trace stores digests of arguments, not the paths themselves; the
          reason is what the pack recorded.
        </p>
        {v.denials.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No denials in the trace.
          </p>
        ) : (
          <ul data-testid="denials" className="space-y-1">
            {v.denials.map((d, i) => (
              <Denial key={`${d.seq}-${i}`} denial={d} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
