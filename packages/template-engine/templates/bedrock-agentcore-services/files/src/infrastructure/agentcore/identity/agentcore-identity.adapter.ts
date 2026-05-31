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
    const resolved =
      workloadName ?? process.env.AGENTCORE_WORKLOAD_IDENTITY_ARN;
    if (!resolved) {
      throw new Error(
        "AGENTCORE_WORKLOAD_IDENTITY_ARN is not set — provision identity and copy the value " +
          "from `agentcore status` into .env.local.",
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
    const res = await this.client.send(
      new GetResourceOauth2TokenCommand({
        workloadName: this.workloadName,
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
