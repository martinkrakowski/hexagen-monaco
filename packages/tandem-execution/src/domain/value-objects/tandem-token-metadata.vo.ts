export interface TandemTokenMetadata {
  stage1PromptTokens?: number;
  stage1CompletionTokens?: number;
  stage2PayloadTokens?: number;
  stage3PromptTokens?: number;
  stage3CompletionTokens?: number;
  estimatedCost?: number;
}
