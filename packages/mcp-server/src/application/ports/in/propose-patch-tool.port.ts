import type { Grant } from "../../kernel/grant.js";

/**
 * Inbound (driving) port per ADR-0048 for `hexagen_propose_patch`: the use case
 * implements it and the MCP tool adapter calls it.
 */
export interface ProposePatchToolInput {
  /**
   * A git-style unified diff. Nothing here ever applies it. Typed `unknown`
   * because it comes straight from a tool call: a non-string is a grant-checked,
   * traced refusal, not a crash.
   */
  patch: unknown;
  /** The signed Grant for this call; absent or id-less is a `grant_missing` denial. */
  grant?: Grant;
  /** Used for the trace only when `.hexagen/slice.json` gives no slice id. */
  goal_id?: string;
}

export type ProposePatchToolResult =
  | {
      readonly allowed: true;
      readonly proposal_id: string;
      /** Repo-relative, under `.hexagen/proposals/`. */
      readonly patch_file: string;
      readonly meta_file: string;
      readonly paths: readonly string[];
      /** Position of the evidence line in a chained trace; null when unchained. */
      readonly trace_seq: number | null;
      /** What the FDE runs; this tool never does. */
      readonly apply_with: string;
    }
  | {
      readonly allowed: false;
      readonly code: string;
      readonly reason: string;
      /** Set when the denial's own evidence line could not be written. */
      readonly trace_write_error?: string;
    };

export interface ProposePatchToolPort {
  execute(input: ProposePatchToolInput): Promise<ProposePatchToolResult>;
}
