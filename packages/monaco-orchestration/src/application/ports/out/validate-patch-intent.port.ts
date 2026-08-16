/**
 * Outbound (driven) port: validates whether a proposed semantic patch/intent is
 * safe and valid to apply.
 *
 * Direction per ADR-0048: `ValidatePatchIntentUseCase` *depends on* this
 * contract (constructor injection,
 * `src/application/use-cases/validate-patch-intent.use-case.ts`) and an
 * infrastructure adapter (Zod schema validator, business-rules engine, safety
 * checker, AI confidence scorer, …) *implements* it. Depended-on by the use
 * case and implemented by an adapter is the definition of driven, hence
 * `ports/out` rather than `ports/in`.
 */
export interface ValidatePatchIntentPort {
  validate(data: unknown): Promise<unknown>;
}
