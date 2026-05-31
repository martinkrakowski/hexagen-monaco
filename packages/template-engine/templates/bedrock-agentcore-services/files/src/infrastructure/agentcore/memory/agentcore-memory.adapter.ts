// @hexagen-server-only
import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  RetrieveMemoryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type {
  MemoryPort,
  MemoryRecord,
  MemoryTurn,
} from "../../../domain/ports/out/agent-memory.port";
import { loadMemoryConfig, type MemoryConfig } from "./memory-config";

/**
 * AgentCore Memory adapter — the AWS↔domain translation boundary for {@link MemoryPort}.
 *
 * `store()` writes a turn via CreateEvent; `retrieve()` runs semantic/summary
 * recall via RetrieveMemoryRecords. Region is never hardcoded — it resolves from
 * the AGENTCORE_REGION → AWS_REGION cascade (and otherwise the SDK's own chain).
 *
 * NOTE: AgentCore Memory data-plane command shapes are still stabilising; if your
 * installed @aws-sdk/client-bedrock-agentcore version differs, adjust the field
 * names here — the port contract above stays the same.
 */
export class AgentCoreMemoryAdapter implements MemoryPort {
  private readonly client: BedrockAgentCoreClient;
  private readonly config: MemoryConfig;

  constructor(client?: BedrockAgentCoreClient, config?: MemoryConfig) {
    const region = process.env.AGENTCORE_REGION ?? process.env.AWS_REGION;
    this.client = client ?? new BedrockAgentCoreClient(region ? { region } : {});
    this.config = config ?? loadMemoryConfig();
  }

  async store(sessionId: string, turn: MemoryTurn): Promise<void> {
    await this.client.send(
      new CreateEventCommand({
        memoryId: this.config.memoryId,
        sessionId,
        actorId: turn.role,
        eventTimestamp: turn.timestamp ? new Date(turn.timestamp) : new Date(),
        payload: [
          {
            conversational: {
              role: turn.role.toUpperCase(),
              content: { text: turn.content },
            },
          },
        ],
      }),
    );
  }

  async retrieve(
    sessionId: string,
    query: string,
    limit = 5,
  ): Promise<MemoryRecord[]> {
    const res = await this.client.send(
      new RetrieveMemoryRecordsCommand({
        memoryId: this.config.memoryId,
        namespace: this.config.namespace,
        searchCriteria: { searchQuery: query, topK: limit },
      }),
    );

    const summaries = res.memoryRecordSummaries ?? [];
    return summaries.map((r) => ({
      content: r.content?.text ?? "",
      score: r.score,
      kind: r.memoryStrategyType,
    }));
  }
}
