/* eslint-disable @typescript-eslint/no-explicit-any */

// Dedicated WebLLM worker — bundled by webpack 5 via new URL() in wire.ts.
// Imports @mlc-ai/web-llm from npm (no CDN fetch), which means WASM and
// model-fetch paths are resolved correctly by the bundler.

let engine: any = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, data } = e.data as { type: string; data: any };

  if (type === "init") {
    try {
      const { CreateMLCEngine } = await import("@mlc-ai/web-llm");

      engine = await CreateMLCEngine(data.modelId, {
        initProgressCallback: (mlcProgress: any) => {
          const text = (mlcProgress.text || "").toLowerCase();
          let phase = "loading-model";
          if (text.includes("compil") || text.includes("shader")) {
            phase = "compiling-shader";
          } else if (text.includes("init") && !text.includes("loading")) {
            phase = "initializing-engine";
          }
          self.postMessage({
            type: "progress",
            data: {
              progress: mlcProgress.progress ?? 0,
              text: mlcProgress.text ?? "",
              phase,
            },
          });
        },
      });

      self.postMessage({ type: "ready" });
    } catch (err: any) {
      self.postMessage({ type: "error", data: err?.message ?? String(err) });
    }
  } else if (type === "generate") {
    if (!engine) {
      self.postMessage({ type: "error", data: "Engine not initialized" });
      return;
    }

    try {
      const messages = (data.messages as any[]).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const stream = data.stream ?? false;

      if (stream) {
        const streamResult = await engine.chat.completions.create({
          messages,
          temperature: data.temperature ?? 0.45,
          max_tokens: data.maxTokens ?? 768,
          top_p: data.topP,
          top_k: data.topK,
          frequency_penalty: data.frequencyPenalty,
          presence_penalty: data.presencePenalty,
          stream: true,
        });
        for await (const chunk of streamResult) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            self.postMessage({ type: "chunk", data: content });
          }
        }
        self.postMessage({ type: "done", data: "" });
      } else {
        const result = await engine.chat.completions.create({
          messages,
          temperature: data.temperature ?? 0.45,
          max_tokens: data.maxTokens ?? 768,
          top_p: data.topP,
          top_k: data.topK,
          frequency_penalty: data.frequencyPenalty,
          presence_penalty: data.presencePenalty,
          stream: false,
        });
        self.postMessage({
          type: "result",
          data: result.choices[0]?.message?.content || "",
        });
      }
    } catch (err: any) {
      self.postMessage({ type: "error", data: err?.message ?? String(err) });
    }
  }
};
