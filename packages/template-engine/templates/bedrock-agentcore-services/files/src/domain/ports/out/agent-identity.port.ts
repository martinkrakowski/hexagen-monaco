/**
 * Outbound port for AgentCore Identity — the agent's own workload identity plus
 * outbound credential exchange to third-party resources.
 *
 * Framework-neutral: returns domain credential shapes, never AWS SDK responses.
 * Claim → {@link UserContext} mapping for inbound callers lives in `idp-bridge.ts`.
 */
export interface WorkloadToken {
  readonly token: string;
  /** ISO-8601 expiry, when the provider returns one. */
  readonly expiresAt?: string;
}

export interface OutboundCredential {
  readonly accessToken: string;
  readonly expiresAt?: string;
  /** Scopes actually granted for the exchanged credential. */
  readonly scopes?: string[];
}

export interface AgentIdentityPort {
  /** Fetch the agent's workload identity token (for calling AWS / the Gateway). */
  getWorkloadToken(): Promise<WorkloadToken>;
  /** Exchange the workload identity for an outbound credential to `resource`. */
  exchangeForOutbound(resource: string): Promise<OutboundCredential>;
}
