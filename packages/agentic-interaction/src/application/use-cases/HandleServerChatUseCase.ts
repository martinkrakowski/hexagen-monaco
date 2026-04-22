import type {
  ServerLLMRequestPort,
  ServerLLMRequest,
  ServerLLMUserInfo,
} from "../ports/in/ServerLLMRequestPort.js";
import type {
  LLMProviderPort,
  LLMCompletionRequest,
} from "../../domain/ports/llm-provider.port.js";

export class HandleServerChatUseCase implements ServerLLMRequestPort {
  constructor(
    private readonly llmProvider: LLMProviderPort,
    private readonly defaultModel: string,
  ) {}

  async handleRequest(
    request: ServerLLMRequest,
    _userInfo: ServerLLMUserInfo, // userInfo reserved for future fine-grained ACLs / logging via injected LoggerPort
  ): Promise<ReadableStream<Uint8Array>> {
    const completionRequest: LLMCompletionRequest = {
      model: this.defaultModel,
      messages: request.messages as Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }>,
    };

    const stream = this.llmProvider.streamComplete(completionRequest);

    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const result of stream) {
            if (result.success) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "chunk", content: result.value })}\n\n`,
                ),
              );
            } else {
              const errorMsg =
                result.error instanceof Error
                  ? result.error.message
                  : String(result.error);
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`,
                ),
              );
              break;
            }
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
          );
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return readableStream;
  }
}
