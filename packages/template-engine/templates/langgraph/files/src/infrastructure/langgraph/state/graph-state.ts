import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

/**
 * Shared state schema for the agent graph. Every node reads from this
 * object and returns a Partial<GraphState>; LangGraph merges via the
 * declared reducers (append-only for messages/steps, last-write-wins for
 * scalar fields). Adding a new piece of state is a one-line extension
 * here — no node needs to change to read existing fields.
 */
export const GraphStateAnnotation = Annotation.Root({
  /** Conversation history. Append-only — never re-assigned wholesale. */
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  /** The original user prompt — preserved verbatim for downstream reference. */
  input: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  /** Final formatted response; null until the output formatter (or equivalent) writes it. */
  output: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  /** Append-only audit of which nodes ran, used by /invoke's response and observability. */
  steps: Annotation<string[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => [],
  }),
  /** Thread id used by the checkpointer. The adapter sets this if not provided. */
  threadId: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "",
  }),
  /** Surface error from a node so downstream routing can short-circuit to END. */
  errorMessage: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  /**
   * Carries the reviewer's feedback when a paused graph is resumed via the
   * /api/agent/resume route. Kept as its own field — deliberately NOT
   * folded into `input` — so the original user prompt remains intact and
   * the human-review node (or any downstream node) can branch on the two
   * independently. The adapter's resume() method writes only this key, so
   * the checkpointed `input` is preserved.
   */
  humanInput: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
});

export type GraphState = typeof GraphStateAnnotation.State;
export type GraphStateUpdate = typeof GraphStateAnnotation.Update;
