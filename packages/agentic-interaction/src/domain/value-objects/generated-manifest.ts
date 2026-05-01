/**
 * Value object representing a generated manifest with metadata
 */

export interface GenerationMetadata {
  /**
   * LLM model used for generation
   */
  model: string;

  /**
   * Prompt template version
   */
  promptVersion?: string;

  /**
   * When manifest was generated
   */
  generatedAt?: Date;

  /**
   * Processing time in milliseconds
   */
  processingTime: number;

  /**
   * Number of tokens used
   */
  tokensUsed: number;
  
  /**
   * The provider that generated the manifest (local, openai, anthropic, etc.)
   */
  provider?: string;
}

export interface GeneratedManifest {
  /**
   * Generated manifest YAML content
   */
  manifest: string;

  /**
   * Confidence score (0-1)
   */
  confidence: number;

  /**
   * Suggestions for user
   */
  suggestions: string[];

  /**
   * Warnings about potential issues
   */
  warnings: string[];

  /**
   * Generation metadata
   */
  metadata: GenerationMetadata;
}

export class GeneratedManifestValidator {
  private static readonly MIN_CONFIDENCE = 0.3;
  private static readonly REQUIRED_YAML_KEYS = ["workspace", "boundedContexts"];

  /**
   * Validate generated manifest
   * @throws Error if validation fails
   */
  static validate(generated: GeneratedManifest): void {
    // Check confidence threshold
    if (generated.confidence < this.MIN_CONFIDENCE) {
      throw new Error(
        `Confidence too low: ${generated.confidence}. Minimum ${this.MIN_CONFIDENCE} required.`,
      );
    }

    // Check manifest is not empty
    if (!generated.manifest || generated.manifest.trim().length === 0) {
      throw new Error("Generated manifest is empty.");
    }

    // Check for required YAML keys
    for (const key of this.REQUIRED_YAML_KEYS) {
      if (!generated.manifest.includes(`${key}:`)) {
        throw new Error(`Generated manifest missing required key: ${key}`);
      }
    }

    // Check metadata
    if (!generated.metadata) {
      throw new Error("Generation metadata is missing.");
    }

    if (generated.metadata.processingTime <= 0) {
      throw new Error("Invalid processing time.");
    }
  }

  /**
   * Calculate confidence score based on manifest completeness
   */
  static calculateConfidence(manifest: string): number {
    let score = 0.5; // Base score

    // Check for workspace definition
    if (manifest.includes("workspace:")) score += 0.1;
    if (manifest.includes("name:")) score += 0.05;
    if (manifest.includes("description:")) score += 0.05;

    // Check for bounded contexts
    if (manifest.includes("boundedContexts:")) score += 0.1;

    // Check for ports
    if (manifest.includes("ports:")) score += 0.1;
    if (manifest.includes("in:")) score += 0.05;
    if (manifest.includes("out:")) score += 0.05;

    // Check for adapters
    if (manifest.includes("adapters:")) score += 0.1;

    // Ensure score is between 0 and 1
    return Math.min(1.0, Math.max(0.0, score));
  }
}

/**
 * Create a generated manifest result
 */
export function createGeneratedManifest(
  manifest: string,
  metadata: GenerationMetadata,
  options?: {
    suggestions?: string[];
    warnings?: string[];
  },
): GeneratedManifest {
  const confidence = GeneratedManifestValidator.calculateConfidence(manifest);

  const generated: GeneratedManifest = {
    manifest,
    confidence,
    suggestions: options?.suggestions || [],
    warnings: options?.warnings || [],
    metadata,
  };

  GeneratedManifestValidator.validate(generated);

  return generated;
}

// Made with Bob
