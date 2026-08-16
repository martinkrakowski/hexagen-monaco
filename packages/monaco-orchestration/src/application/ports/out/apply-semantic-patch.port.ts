/**
 * Outbound (driven) port: applies a semantic patch to the current buffer/state.
 *
 * Direction per ADR-0048: `ApplySemanticPatchUseCase` *depends on* this
 * contract (constructor injection,
 * `src/application/use-cases/apply-semantic-patch.use-case.ts`) and an
 * infrastructure adapter (Monaco Editor model, AST transformer, text-model
 * adapter, …) *implements* it. Depended-on by the use case and implemented by
 * an adapter is the definition of driven, hence `ports/out` rather than
 * `ports/in`.
 */
export interface ApplySemanticPatchPort {
  apply(data: unknown): Promise<unknown>;
}
