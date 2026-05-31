// @hexagen-server-only
import {
  BedrockAgentCoreClient,
  GetWorkloadAccessTokenCommand,
  GetResourceOauth2TokenCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type {
  AgentIdentityPort,
  OutboundCredential,
  WorkloadToken,
} from "../../../domain/ports/out/agent-identity.port";

/**
 * AgentCore Identity adapter — the AWS↔domain boundary for {@link AgentIdentityPort}.
 *
 * `getWorkloadToken()` fetches the agent's workload identity token;
 * `exchangeForOutbound()` trades it for a 3p (OAuth2) credential so the agent can
 * call downstream resources as itself. Region resolves from the
 * AGENTCORE_REGION → AWS_REGION cascade — never hardcoded.
 *
 * NOTE: AgentCore Identity command shapes are still stabilising; adjust field
 * names to your installed @aws-sdk/client-bedrock-agentcore version if they
 * differ. The port contract stays the same.
 */
export class AgentCoreIdentityAdapter implements AgentIdentityPort {
  private readonly client: BedrockAgentCoreClient;
  private readonly workloadName: string;

  constructor(client?: BedrockAgentCoreClient, workloadName?: string) {
    const region = process.env.AGENTCORE_REGION ?? process.env.AWS_REGION;
    this.client = client ?? new BedrockAgentCoreClient(region ? { region } : {});
    // GetWorkloadAccessToken expects the registered workload *name*, not the ARN.
    // Prefer an explicit name; otherwise derive it from the ARN, whose final path
    // segment is the workload identity name (.../workload-identity/<name>).
    const arn = process.env.AGENTCORE_WORKLOAD_IDENTITY_ARN;
    const resolved =
      workloadName ??
      process.env.AGENTCORE_WORKLOAD_NAME ??
      (arn ? workloadNameFromArn(arn) : undefined);
    if (!resolved) {
      throw new Error(
        "Set AGENTCORE_WORKLOAD_NAME (or AGENTCORE_WORKLOAD_IDENTITY_ARN) — provision identity " +
          "and copy the value from `agentcore status` into .env.local.",
      );
    }
    this.workloadName = resolved;
  }

  async getWorkloadToken(): Promise<WorkloadToken> {
    const res = await this.client.send(
      new GetWorkloadAccessTokenCommand({ workloadName: this.workloadName }),
    );
    const token = res.workloadAccessToken;
    if (!token) {
      throw new Error("AgentCore returned no workload access token");
    }
    return { token };
  }

  async exchangeForOutbound(resource: string): Promise<OutboundCredential> {
    // The outbound exchange identifies the agent by its workload identity token,
    // not its name — fetch the token first, then trade it for the 3p credential.
    const { token } = await this.getWorkloadToken();
    const res = await this.client.send(
      new GetResourceOauth2TokenCommand({
        workloadIdentityToken: token,
        resourceCredentialProviderName: resource,
      }),
    );
    const accessToken = res.accessToken;
    if (!accessToken) {
      throw new Error(`AgentCore returned no outbound credential for "${resource}"`);
    }
    return { accessToken, scopes: res.scope?.split(" ").filter(Boolean) };
  }
}

/** Extract the workload identity name from its ARN (.../workload-identity/<name>). */
function workloadNameFromArn(arn: string): string {
  const slash = arn.lastIndexOf("/");
  return slash >= 0 ? arn.slice(slash + 1) : arn;
}
