import { LLMRouter } from "./router/llm-router";

async function main() {
  const router = new LLMRouter();
  console.log("LLM smoke test — calling router with callType: fast...");

  const result = await router.call('Say only the word "OK" and nothing else.', {
    callType: "fast",
    maxTokens: 10,
  });

  if (!result.success) {
    console.error("Smoke test FAILED:", result.error.message);
    process.exit(1);
  }

  console.log("Smoke test PASSED:", result.value.content.trim());
  console.log("Model:", result.value.model);
  console.log("Tokens:", result.value.usage.totalTokens);
}

main().catch((e) => {
  console.error("Smoke test threw:", e);
  process.exit(1);
});
