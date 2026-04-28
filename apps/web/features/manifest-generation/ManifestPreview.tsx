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
}

interface ManifestPreviewProps {
  manifest: string;
  confidence: number;
  suggestions: string[];
  warnings: string[];
  metadata: GenerationMetadata;
  onUseManifest?: (manifest: string) => void;
  onRegenerate?: () => void;
}

export function ManifestPreview({
  manifest,
  confidence,
  suggestions,
  warnings,
  metadata,
  onUseManifest,
  onRegenerate,
}: ManifestPreviewProps) {
  const confidenceColor =
    confidence >= 0.8
      ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200"
      : confidence >= 0.6
        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200"
        : "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-200";

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(manifest);
  };

  const handleUseManifest = () => {
    if (onUseManifest) {
      onUseManifest(manifest);
    }
  };

  return (
    <div className="flex flex-col min-h-screen p-8 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="w-full max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              Generated Manifest
            </h1>
            <p className="text-slate-600 dark:text-slate-400">
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
                <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Confidence Score
                </h3>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
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
            <div className="mt-4 text-sm text-slate-600 dark:text-slate-400">
              <p>
                Model: {metadata.model} • Processing: {metadata.processingTime}
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
                <pre className="p-4 bg-slate-900 dark:bg-slate-950 text-slate-100 rounded-md overflow-x-auto text-sm font-mono max-h-96 overflow-y-auto">
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
                  <CardTitle className="text-orange-600 dark:text-orange-400">
                    ⚠️ Warnings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {warnings.map((warning, index) => (
                      <li
                        key={index}
                        className="text-slate-700 dark:text-slate-300"
                      >
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
                  <CardTitle className="text-blue-600 dark:text-blue-400">
                    💡 Suggestions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {suggestions.map((suggestion, index) => (
                      <li
                        key={index}
                        className="text-slate-700 dark:text-slate-300"
                      >
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
