// @hexagen-server-only
// Registers Bedrock with the base llm-adapter router via the provider seam, so
// no base files are overwritten. Import this module once at startup, before any
// `new LLMRouter(...)`, so "bedrock" resolves:
//
//   import "./infrastructure/llm/adapters/bedrock-register";
//
import { registerProvider } from "../router/provider-registry";
import { BedrockLLMClientAdapter } from "./bedrock-llm-client.adapter";

registerProvider("bedrock", {
  factory: () => new BedrockLLMClientAdapter(),
  // Model ids resolve from env (consistent with every other provider),
  // defaulting to the inference profile chosen at install time.
  models: {
    reasoning: process.env.BEDROCK_REASONING_MODEL ?? "{bedrock_inference}",
    fast: process.env.BEDROCK_FAST_MODEL ?? "{bedrock_inference}",
    vision: process.env.BEDROCK_VISION_MODEL ?? "{bedrock_inference}",
  },
});
