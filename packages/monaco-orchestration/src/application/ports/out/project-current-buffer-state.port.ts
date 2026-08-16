/**
 * Outbound (driven) port: retrieves the current state of the Monaco buffer
 * (content, cursor, selections, …).
 *
 * Direction per ADR-0048: `ProjectCurrentBufferStateUseCase` *depends on* this
 * contract (constructor injection,
 * `src/application/use-cases/project-current-buffer-state.use-case.ts`) and an
 * infrastructure adapter (Monaco Editor instance, text-model wrapper, snapshot
 * service) *implements* it. Depended-on by the use case and implemented by an
 * adapter is the definition of driven, hence `ports/out` rather than
 * `ports/in`.
 */
export interface ProjectCurrentBufferStatePort {
  getCurrentState(data: unknown): Promise<unknown>;
}
