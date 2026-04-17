export interface LLMProgress {
  progress: number;
  text: string;
  phase:
    | "loading-model"
    | "compiling-shader"
    | "initializing-engine"
    | "ready"
    | "error";
}

export interface LLMProgressCallback {
  (progress: LLMProgress): void;
}
