/**
 * Preview component for generated manifest with confidence score and suggestions
 */

"use client";

import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from "@hexagen/ui";

interface GenerationMetadata {
  model: string;
  processingTime: number;
  tokensUsed: number;
  provider?: string;
}

interface ManifestPreviewProps {
  manifest: string;
  confidence: number;
  suggestions: string[];
  warnings: string[];
  metadata: GenerationMetadata;
  onUseManifest?: (manifest: string) => void;
  onRegenerate?: () => void;
  onReject?: () => void;
}

export function ManifestPreview({
  manifest,
  confidence,
  suggestions,
  warnings,
  metadata,
  onUseManifest,
  onRegenerate,
  onReject,
}: ManifestPreviewProps) {
  const confidenceColor =
    confidence >= 0.8
      ? "bg-success/20 text-success"
      : confidence >= 0.6
        ? "bg-warning/20 text-warning"
        : "bg-destructive/20 text-destructive";

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(manifest);
  };

  const handleUseManifest = async () => {
    console.log(
      "[ManifestPreview] handleUseManifest called, onUseManifest type:",
      typeof onUseManifest,
    );
    if (!onUseManifest) {
      console.log("[ManifestPreview] onUseManifest is undefined!");
      return;
    }
    try {
      await onUseManifest(manifest);
      console.log("[ManifestPreview] onUseManifest completed");
    } catch (err) {
      console.error("[ManifestPreview] onUseManifest error:", err);
    }
  };

  return (
    <div className="flex flex-col min-h-screen p-8 bg-background">
      <div className="w-full max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              Generated Manifest
            </h1>
            <p className="text-muted-foreground">
              Review your manifest and proceed to the project wizard
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onRegenerate}>
              ← Back
            </Button>
          </div>
        </div>

        {/* Confidence Score */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">
                  Confidence Score
                </h3>
                <p className="text-2xl font-bold text-foreground">
                  {(confidence * 100).toFixed(0)}%
                </p>
              </div>
              <Badge className={confidenceColor}>
                {confidence >= 0.8
                  ? "High"
                  : confidence >= 0.6
                    ? "Medium"
                    : "Low"}
              </Badge>
            </div>
            <div className="mt-4 text-sm text-muted-foreground">
              <p>
                Model: {metadata.model}
                {metadata.provider ? ` (${metadata.provider})` : ""} •
                Processing: {metadata.processingTime}
                ms • Tokens: {metadata.tokensUsed}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Manifest Preview */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Manifest YAML</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyToClipboard}
                  >
                    Copy
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="p-4 bg-muted text-foreground rounded-md overflow-x-auto text-sm font-mono max-h-96 overflow-y-auto">
                  {manifest}
                </pre>
              </CardContent>
            </Card>
          </div>

          {/* Suggestions and Warnings */}
          <div className="space-y-4">
            {/* Warnings */}
            {warnings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-warning">⚠️ Warnings</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {warnings.map((warning, index) => (
                      <li key={index} className="text-foreground">
                        • {warning}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-info">💡 Suggestions</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {suggestions.map((suggestion, index) => (
                      <li key={index} className="text-foreground">
                        • {suggestion}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-4">
          <Button variant="ghost" onClick={onReject}>
            Start Over
          </Button>
          <Button variant="outline" onClick={onRegenerate}>
            Regenerate
          </Button>
          <Button onClick={handleUseManifest} size="lg">
            Use This Manifest →
          </Button>
        </div>
      </div>
    </div>
  );
}

// Made with Bob
