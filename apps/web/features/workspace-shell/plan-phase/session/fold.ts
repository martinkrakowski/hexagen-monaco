import type { ProjectLayerTurn } from "@hexagen/shared";
import type { ModelRole } from "./planning-session";

/**
 * Fold builder (decided open question Q1): ONE model (the server's LLM_MODEL)
 * playing two roles via role prompts, and each model turn receives a SINGLE
 * grounded user message — not the raw chat history. The fold contains:
 *
 *   role preamble + seed brief + latest proposal + latest critique
 *   + any human steering turns added since the last model turn
 *
 * Folding keeps token cost bounded (Q5: each round is 2 chat requests) and
 * makes the turn deterministic to test: same turns in → same prompt out.
 */

const PROPOSER_PREAMBLE = `You are the PROPOSER in a two-role architecture brainstorm.
Produce (or revise) a concise architecture proposal for the brief below: bounded contexts, their responsibilities, and the ports/adapters between them.
If a critique is present, address every point it raises — revise, don't defend.
Keep the proposal self-contained: it replaces, not amends, the previous one.`;

const CRITIC_PREAMBLE = `You are the CRITIC in a two-role architecture brainstorm.
Review the latest proposal against the brief below: find missing contexts, leaky boundaries, misplaced responsibilities, and unstated coupling. Be specific and actionable.
Your reply MUST end with exactly one final line, either:
VERDICT: CONVERGED
VERDICT: CONTINUE
Use CONVERGED only when the proposal needs no further structural changes.`;

export interface FoldInput {
  readonly role: ModelRole;
  readonly seed: string;
  readonly turns: readonly ProjectLayerTurn[];
  readonly round: number;
  readonly maxRounds: number;
}

/** Build the single grounded message for the next model turn. */
export function buildFold(input: FoldInput): string {
  const { role, seed, turns, round, maxRounds } = input;

  const lastProposal = findLast(turns, (t) => t.role === "proposer");
  const lastCritique = findLast(turns, (t) => t.role === "critic");
  const steering = humanTurnsSinceLastModelTurn(turns);

  const sections: string[] = [
    role === "proposer" ? PROPOSER_PREAMBLE : CRITIC_PREAMBLE,
    `Round ${round} of ${maxRounds}.`,
    section("Brief", seed),
  ];
  if (lastProposal)
    sections.push(section("Latest proposal", lastProposal.content));
  if (lastCritique)
    sections.push(section("Latest critique", lastCritique.content));
  if (steering.length > 0) {
    sections.push(
      section(
        "Human steering (must be honored)",
        steering.map((t) => `- ${t.content}`).join("\n"),
      ),
    );
  }
  return sections.join("\n\n");
}

function section(title: string, body: string): string {
  return `## ${title}\n${body.trim()}`;
}

function findLast<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return items[i];
  }
  return undefined;
}

/**
 * Human steering turns added AFTER the last model (proposer/critic) turn —
 * earlier steering has already been folded into the model turns that followed
 * it, so repeating it would double-weight stale guidance.
 */
export function humanTurnsSinceLastModelTurn(
  turns: readonly ProjectLayerTurn[],
): ProjectLayerTurn[] {
  const out: ProjectLayerTurn[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role === "proposer" || turn.role === "critic") break;
    if (turn.role === "human") out.unshift(turn);
  }
  return out;
}
