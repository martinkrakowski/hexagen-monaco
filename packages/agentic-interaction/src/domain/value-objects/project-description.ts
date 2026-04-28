/**
 * Value object representing a user's natural language project description
 */

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ProjectDescription {
  /**
   * Raw user input describing their project
   */
  text: string;

  /**
   * Detected or specified language (default: 'en')
   */
  language: string;

  /**
   * When the description was provided
   */
  timestamp: Date;

  /**
   * Optional platform specification
   */
  platform?: string;

  /**
   * Optional deployment target
   */
  deployment?: string;

  /**
   * Any additional context provided by user
   */
  additionalContext?: string;
}

export class ProjectDescriptionValidator {
  private static readonly MIN_LENGTH = 10;
  private static readonly MAX_LENGTH = 2000;
  private static readonly DANGEROUS_PATTERNS = [
    /ignore previous instructions/i,
    /system prompt/i,
    /you are now/i,
    /<script>/i,
    /javascript:/i,
  ];

  /**
   * Validate project description
   * @throws Error if validation fails
   */
  static validate(description: ProjectDescription): void {
    // Check length
    if (description.text.length < this.MIN_LENGTH) {
      throw new Error(
        `Description too short. Minimum ${this.MIN_LENGTH} characters required.`,
      );
    }

    if (description.text.length > this.MAX_LENGTH) {
      throw new Error(
        `Description too long. Maximum ${this.MAX_LENGTH} characters allowed.`,
      );
    }

    // Check for prompt injection attempts
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(description.text)) {
        throw new Error(
          "Description contains potentially dangerous content. Please rephrase.",
        );
      }
    }

    // Check for empty or whitespace-only
    if (description.text.trim().length === 0) {
      throw new Error("Description cannot be empty or whitespace only.");
    }
  }

  /**
   * Sanitize description text
   */
  static sanitize(text: string): string {
    // Remove any HTML tags
    let sanitized = text.replace(/<[^>]*>/g, "");

    // Remove any script-like content
    sanitized = sanitized.replace(/javascript:/gi, "");

    // Trim whitespace
    sanitized = sanitized.trim();

    return sanitized;
  }
}

/**
 * Create a project description from user input
 */
export function createProjectDescription(
  text: string,
  options?: {
    language?: string;
    platform?: string;
    deployment?: string;
    additionalContext?: string;
  },
): ProjectDescription {
  const sanitizedText = ProjectDescriptionValidator.sanitize(text);

  const description: ProjectDescription = {
    text: sanitizedText,
    language: options?.language || "en",
    timestamp: new Date(),
    platform: options?.platform,
    deployment: options?.deployment,
    additionalContext: options?.additionalContext,
  };

  ProjectDescriptionValidator.validate(description);

  return description;
}

// Made with Bob
