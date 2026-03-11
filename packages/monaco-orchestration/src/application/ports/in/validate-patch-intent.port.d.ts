export interface ValidatePatchIntentPort {
    /**
     * Validates whether a proposed semantic patch/intent is safe and valid to apply.
     * Infrastructure adapters (Zod schema validator, business rules engine,
     * safety checker, AI confidence scorer, etc.) implement this contract.
     */
    validate(data: unknown): Promise<unknown>;
}
//# sourceMappingURL=validate-patch-intent.port.d.ts.map