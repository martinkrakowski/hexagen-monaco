import { z } from "zod";
import type { StructuredOutputSchema } from "../../domain/structured-output-schema";
import type {
  GenerateZodSchemaPort,
  GenerateZodSchemaRequest,
} from "../../application/ports/in/generate-zod-schema.port";

/**
 * Adapter that generates Zod schemas using the Responsible Response Pattern (RRP).
 * This adapter creates structured output schemas that define the expected format
 * for LLM responses, ensuring they conform to specific validation rules.
 *
 * Supports two modes:
 * 1. Compiled contract mode: Deterministic generation from contract definitions
 * 2. Type inference mode: Infer schema from example data (backward compatible)
 */
export class RRPZodSchemaGeneratorAdapter implements GenerateZodSchemaPort {
  async generate(
    request: GenerateZodSchemaRequest,
  ): Promise<StructuredOutputSchema> {
    if (request.compiledContract) {
      return this.generateFromContract(request);
    }
    return this.generateFromExampleData(request);
  }

  private async generateFromContract(
    request: GenerateZodSchemaRequest,
  ): Promise<StructuredOutputSchema> {
    const contract = request.compiledContract!;

    // Build Zod schema from contract
    const fieldSchemas: Record<string, z.ZodTypeAny> = {};
    Object.entries(contract.fields || {}).forEach(([fieldName, fieldDef]) => {
      let schema: z.ZodTypeAny;
      switch (fieldDef.type) {
        case "string":
          schema = z.string();
          break;
        case "number":
          schema = z.number();
          break;
        case "boolean":
          schema = z.boolean();
          break;
        case "array":
          schema = z.array(z.unknown());
          break;
        default:
          schema = z.unknown();
      }

      if (!fieldDef.required) {
        schema = schema.optional();
      }
      fieldSchemas[fieldName] = schema;
    });

    const zodSchema = z.object(fieldSchemas);

    // Validate example against contract if provided
    if (request.exampleData) {
      const validation = zodSchema.safeParse(request.exampleData);
      if (!validation.success) {
        console.warn(
          `[Zod] Example data failed validation against contract: ${validation.error.message}`,
        );
      }
    }

    // Return structured output
    return {
      id: `rrp-zod-schema-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      schema: zodSchema,
      version: 1,
      updatedAt: new Date().toISOString(),
    };
  }

  private async generateFromExampleData(
    request: GenerateZodSchemaRequest,
  ): Promise<StructuredOutputSchema> {
    // Create a Zod schema based on the example data
    // In a real implementation, this would infer the schema structure from the example
    // For now, we'll create a simple string validation schema as a placeholder
    let schema: z.ZodTypeAny;

    if (typeof request.exampleData === "string") {
      schema = z.string();
    } else if (typeof request.exampleData === "number") {
      schema = z.number();
    } else if (typeof request.exampleData === "boolean") {
      schema = z.boolean();
    } else if (Array.isArray(request.exampleData)) {
      schema = z.array(z.unknown());
    } else if (
      request.exampleData !== null &&
      typeof request.exampleData === "object"
    ) {
      schema = z.object({});
    } else {
      schema = z.unknown();
    }

    // Create and return the structured output schema
    return {
      id: `rrp-zod-schema-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      schema,
      version: 1,
      updatedAt: new Date().toISOString(),
    };
  }
}
