/**
 * API endpoint for generating manifest.yaml from natural language descriptions
 * POST /api/manifest/generate
 */

import { NextRequest, NextResponse } from "next/server";
import { GenerateManifestFromDescriptionUseCase } from "@hexagen/agentic-interaction";
import {
  createProjectDescription,
  type ProjectDescription,
} from "@hexagen/agentic-interaction";
import { CloudLLMPipelineAdapter } from "@hexagen/agentic-interaction";
import { EnvironmentSecretVaultAdapter } from "@hexagen/agentic-interaction";

interface GenerateManifestRequestBody {
  description: string;
  language?: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
}

interface GenerateManifestSuccessResponse {
  success: true;
  manifest: string;
  confidence: number;
  suggestions: string[];
  warnings: string[];
  metadata: {
    model: string;
    processingTime: number;
    tokensUsed: number;
  };
}

interface GenerateManifestErrorResponse {
  success: false;
  error: string;
  details?: string;
}

type GenerateManifestResponse =
  | GenerateManifestSuccessResponse
  | GenerateManifestErrorResponse;

/**
 * POST /api/manifest/generate
 * Generate a manifest.yaml file from a natural language project description
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse<GenerateManifestResponse>> {
  try {
    // Parse request body
    const body: GenerateManifestRequestBody = await request.json();

    // Validate required fields
    if (!body.description || typeof body.description !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Missing or invalid description field",
          details: 'Request body must include a "description" string field',
        },
        { status: 400 },
      );
    }

    // Create project description value object
    let projectDescription: ProjectDescription;
    try {
      projectDescription = createProjectDescription(body.description, {
        language: body.language,
        platform: body.platform,
        deployment: body.deployment,
        additionalContext: body.additionalContext,
      });
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid project description",
          details: error instanceof Error ? error.message : "Validation failed",
        },
        { status: 400 },
      );
    }

    // Check for development/mock mode
    const isDevelopment = process.env.NODE_ENV !== "production";
    const useMockLLM =
      isDevelopment &&
      !process.env.OPENAI_API_KEY &&
      !process.env.ANTHROPIC_API_KEY;

    let result;

    if (useMockLLM) {
      // Use a pre-defined mock response for development
      // Log statements are allowed in development for debugging
      if (process.env.NODE_ENV !== "production") {
        console.log("Using mock LLM response for manifest generation");
        console.log(
          "For production usage, set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variables",
        );
      }

      // Mock success response with a sample manifest
      result = {
        success: true,
        manifest: {
          manifest: `
# This is a mock hexagonal architecture manifest generated for development
manifest_version: "1.0"
project:
  name: "mockapp"
  description: "${body.description}"
contexts:
  - name: "User"
    type: "core"
    description: "User management and authentication"
    layers:
      - domain:
          - entity: "User"
            attributes:
              - name: "id"
                type: "string"
              - name: "email"
                type: "string"
              - name: "name"
                type: "string"
      - application:
          - use_case: "RegisterUser"
          - use_case: "AuthenticateUser" 
      - infrastructure:
          - adapter: "UserRepository"
          - adapter: "JWTAuthProvider"
  - name: "Project"
    type: "core"
    description: "Project management"
    layers:
      - domain:
          - entity: "Project"
            attributes:
              - name: "id"
                type: "string"
              - name: "name"
                type: "string"
              - name: "description"
                type: "string"
      - application:
          - use_case: "CreateProject"
          - use_case: "ListProjects"
      - infrastructure:
          - adapter: "ProjectRepository"
api_gateway:
  routes:
    - path: "/api/users"
      operations:
        - method: "POST"
          use_case: "RegisterUser"
    - path: "/api/auth"
      operations:
        - method: "POST"
          use_case: "AuthenticateUser"
    - path: "/api/projects"
      operations:
        - method: "GET"
          use_case: "ListProjects"
        - method: "POST"
          use_case: "CreateProject"
`,
          confidence: 0.9,
          suggestions: [
            "Consider adding a Task context for task management",
            "Add real-time collaboration features",
          ],
          warnings: [],
          metadata: {
            model: "mock-llm-model",
            processingTime: 350,
            tokensUsed: 1024,
          },
        },
      };
    } else {
      // Wire up dependencies
      const secretVault = new EnvironmentSecretVaultAdapter();

      // Configure LLM pipeline with fallback chain
      const llmPipeline = new CloudLLMPipelineAdapter({
        fallbackChain: {
          primary: {
            providerId: "openai",
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-4o",
            apiKeyEnvVar: "OPENAI_API_KEY",
            temperature: 0.3,
            maxTokens: 4000,
          },
          fallbacks: [
            {
              providerId: "anthropic",
              baseUrl: "https://api.anthropic.com/v1",
              model: "claude-3-5-sonnet-20241022",
              apiKeyEnvVar: "ANTHROPIC_API_KEY",
              temperature: 0.3,
              maxTokens: 4000,
            },
          ],
        },
        secretVault,
      });

      // Create and execute use case
      const useCase = new GenerateManifestFromDescriptionUseCase(llmPipeline);
      result = await useCase.execute({
        description: projectDescription,
      });
    }

    // Handle use case result
    if (!result.success || !result.manifest) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Failed to generate manifest",
          details:
            "The LLM was unable to generate a valid manifest from the description",
        },
        { status: 500 },
      );
    }

    // Return successful response
    return NextResponse.json(
      {
        success: true,
        manifest: result.manifest.manifest,
        confidence: result.manifest.confidence,
        suggestions: result.manifest.suggestions,
        warnings: result.manifest.warnings,
        metadata: {
          model: result.manifest.metadata.model,
          processingTime: result.manifest.metadata.processingTime,
          tokensUsed: result.manifest.metadata.tokensUsed,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    // Error logging (not for production)
    if (process.env.NODE_ENV !== "production") {
      console.error("Error generating manifest:", error);
    }

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        details:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
      },
      { status: 500 },
    );
  }
}

/**
 * OPTIONS /api/manifest/generate
 * Handle CORS preflight requests
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// Made with Bob
