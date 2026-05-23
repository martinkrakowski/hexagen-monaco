"use client";

import type { TandemTokenMetadata } from "@hexagen/tandem-execution";

export interface TandemTokenPanelProps {
  tokenMetadata?: TandemTokenMetadata;
  isByok: boolean;
}

export function TandemTokenPanel({
  tokenMetadata,
  isByok,
}: TandemTokenPanelProps) {
  const stage1Tokens =
    tokenMetadata?.stage1PromptTokens !== undefined &&
    tokenMetadata?.stage1CompletionTokens !== undefined
      ? tokenMetadata.stage1PromptTokens + tokenMetadata.stage1CompletionTokens
      : undefined;

  const stage2PayloadTokens = tokenMetadata?.stage2PayloadTokens;

  const stage3Tokens =
    tokenMetadata?.stage3PromptTokens !== undefined &&
    tokenMetadata?.stage3CompletionTokens !== undefined
      ? tokenMetadata.stage3PromptTokens + tokenMetadata.stage3CompletionTokens
      : undefined;

  return (
    <dl className="mt-2 space-y-1 text-xs border-t border-border pt-2">
      {/* Stage 1 tokens — from TandemTokenMetadata */}
      {stage1Tokens !== undefined && (
        <div className="flex gap-2">
          <dt className="text-muted-foreground shrink-0">Stage 1 (local):</dt>
          <dd className="text-foreground">{stage1Tokens} tokens</dd>
        </div>
      )}

      {/* Stage 2 payload — client-side estimate */}
      {stage2PayloadTokens !== undefined && (
        <div className="flex gap-2">
          <dt className="text-muted-foreground shrink-0">
            Stage 2 payload (est.):
          </dt>
          <dd className="text-foreground">{stage2PayloadTokens} tokens</dd>
        </div>
      )}

      {/* Stage 3 tokens — BYOK: always "Not available" (Gate 4C Option B) */}
      <div className="flex gap-2">
        <dt className="text-muted-foreground shrink-0">Stage 3 (cloud):</dt>
        <dd className="text-muted-foreground">
          {isByok
            ? "Not available"
            : stage3Tokens !== undefined
              ? `${stage3Tokens} tokens`
              : "Not available"}
        </dd>
      </div>

      {/* Cost estimate — always "unavailable" for BYOK (Option B) */}
      {isByok && (
        <div className="flex gap-2">
          <dt className="text-muted-foreground shrink-0">Cost estimate:</dt>
          <dd className="text-muted-foreground">Cost estimate unavailable</dd>
        </div>
      )}
    </dl>
  );
}
