import type { WizardData } from "@hexagen/project-configuration";
import {
  ManifestSchema,
  BoundedContextSchema,
  getWorkspaceTemplate,
} from "@hexagen/project-configuration";
import yaml from "js-yaml";

/**
 * Parses a YAML manifest string into WizardData structure
 *
 * @param yamlString - The YAML manifest string to parse
 * @returns WizardData object ready for form hydration
 * @throws Error if parsing fails or validation fails
 *
 * The function performs the following steps:
 * 1. Parses the YAML string to a JavaScript object
 * 2. Validates the parsed object against ManifestSchema
 * 3. Maps bounded contexts to WizardData structure:
 *    - Generates IDs based on context names
 *    - Maps domain entities and value objects
 *    - Extracts use cases
 *    - Searches for persistence adapters (Prisma, TypeORM, Mongoose, Drizzle)
 *    - Searches for messaging adapters (BullMQ, Temporal, RabbitMQ)
 *    - Filters inbound ports to valid types (rest-controller, graphql-resolver, etc.)
 *    - Filters outbound ports to valid types (relational-db, document-db, etc.)
 * 4. Maps workspace governance settings from manifest properties
 *
 * Returns a complete WizardData structure that can be used to hydrate the project wizard.
 */
export function parseManifestToWizardData(yamlString: string): WizardData {
  if (!yamlString || yamlString.trim().length === 0) {
    throw new Error("Manifest string is empty");
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = yaml.load(yamlString);
  } catch (error) {
    throw new Error(
      `Failed to parse YAML: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Validate against the manifest schema. Include each issue's PATH: a bare
  // "Required" gives the user (and the error banner that quotes this message)
  // nothing to act on — "apps.0.name: Required" names the offending field.
  const parseResult = ManifestSchema.safeParse(parsedManifest);
  if (!parseResult.success) {
    throw new Error(
      `Manifest validation failed: ${parseResult.error.errors
        .map((err) =>
          err.path.length > 0
            ? `${err.path.join(".")}: ${err.message}`
            : err.message,
        )
        .join(", ")}`,
    );
  }

  const manifest = parseResult.data;

  // Convert manifest to WizardData structure
  const wizardData: WizardData = {
    boundedContexts:
      manifest.bounded_contexts?.map((bc) => {
        // Validate each bounded context against the schema
        const bcParseResult = BoundedContextSchema.safeParse(bc);
        if (!bcParseResult.success) {
          // If validation fails, we still try to extract what we can
          console.warn(
            "Bounded context validation warning:",
            bcParseResult.error,
          );
        }

        const validatedBc = bcParseResult.success ? bcParseResult.data : bc;

        return {
          id: validatedBc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: validatedBc.name,
          description: validatedBc.description || "",
          // Imported manifests don't carry the wizard-only `infrastructureTarget`;
          // default to the neutral plain-ts API app. (This was effectively the
          // prior behaviour — "nestjs" used to fall back to plain-ts; once it maps
          // to a real NestJS template, hard-coding it would force NestJS on every
          // imported project.)
          infrastructureTarget: "plain-ts",
          coreDomainEntities: validatedBc.layers?.domain?.entities ?? [],
          valueObjects: validatedBc.layers?.domain?.value_objects ?? [],
          domainEvents: [],
          apiFramework: undefined,
          uiFramework: "",
          /**
           * Extracts a persistence adapter from the infrastructure adapters array.
           * Searches for Prisma, TypeORM, Mongoose, or Drizzle, regardless of position.
           */
          persistenceAdapter: (() => {
            const adapters = validatedBc.layers?.infrastructure?.adapters ?? [];
            const persistence = adapters.find(
              (a) =>
                a === "Prisma" ||
                a === "TypeORM" ||
                a === "Mongoose" ||
                a === "Drizzle",
            );
            return persistence ?? "";
          })(),
          /**
           * Extracts a messaging adapter from the infrastructure adapters array.
           * Searches for BullMQ, Temporal, or RabbitMQ, regardless of position.
           */
          messagingAdapter: (() => {
            const adapters = validatedBc.layers?.infrastructure?.adapters ?? [];
            const messaging = adapters.find(
              (a) => a === "BullMQ" || a === "Temporal" || a === "RabbitMQ",
            );
            return messaging ?? "";
          })(),
          telemetryProvider: "",
          externalApiPorts: [],
          llmProviders: [],
          blockchainNetworks: [],
          authenticationProvider: "",
          emailService: "",
          paymentGateway: "",
          storageProvider: "",
          searchService: "",
          webhookEndpoints: [],
          entities: validatedBc.layers?.domain?.entities ?? [],
          useCases: validatedBc.layers?.application?.use_cases ?? [],
          /**
           * Port configuration with validated type filtering. This ensures only allowed port
           * types are included, preventing invalid values from being used in the UI.
           */
          portConfiguration: {
            inboundPorts: (validatedBc.layers?.application?.ports?.in ?? [])
              .map((p) => (typeof p === "string" ? p : p.name))
              .filter(
                (
                  p,
                ): p is
                  | "rest-controller"
                  | "graphql-resolver"
                  | "event-listener"
                  | "cli-command" =>
                  [
                    "rest-controller",
                    "graphql-resolver",
                    "event-listener",
                    "cli-command",
                  ].includes(p),
              ),
            outboundPorts: (validatedBc.layers?.application?.ports?.out ?? [])
              .map((p) => (typeof p === "string" ? p : p.name))
              .filter(
                (
                  p,
                ): p is
                  | "relational-db"
                  | "document-db"
                  | "external-service-client"
                  | "message-publisher" =>
                  [
                    "relational-db",
                    "document-db",
                    "external-service-client",
                    "message-publisher",
                  ].includes(p),
              ),
          },
        };
      }) ?? [],
    externalContexts: [], // Not represented in current manifest schema
    peerMappings: [], // Not represented in current manifest schema
    governance: {
      workspaceName: manifest.system ?? "hexagen-project",
      // Resolve against the workspace-template catalog (single source of truth)
      // rather than a hardcoded id list, so a new template is recognised here
      // automatically. An unknown/absent architecture falls back to the flexible
      // default; `?.id` yields the catalog's typed WorkspaceTemplateId.
      workspaceTemplate:
        getWorkspaceTemplate(
          typeof manifest.architecture === "string"
            ? manifest.architecture
            : "",
        )?.id ?? "modular-monolith",
      workspaceDescription:
        typeof manifest.description === "string"
          ? manifest.description
          : undefined,
      packageManager: "yarn", // Default, not in manifest
      topologyStrictness: "flexible", // Default, not in manifest
      namespacePrefix: manifest.scope ?? "@hexagen",
      namingConventions: {
        contextDirectoryPattern: "packages/",
        adapterSuffix: ".adapter.ts",
      },
    },
    addOnsAnswers: {},
    // Import round-trip integrity (Item 1): this parser is the single entry
    // point for manifest-first projects (file import AND the AI accept flow),
    // and the mapping above is lossy — named ports, context types, depends_on,
    // apps, relationships etc. survive only in the manifest itself. Mark the
    // provenance so the web app's autosave/export paths keep the stored
    // manifestYaml authoritative instead of regenerating it via
    // `wizardToManifest`. Nothing else ever sets this field.
    manifestSource: "imported",
  };

  return wizardData;
}
