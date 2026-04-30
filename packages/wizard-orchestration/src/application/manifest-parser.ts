import type { WizardData } from "@hexagen/project-configuration";
import type { Manifest } from "@hexagen/sync";
import { ManifestSchema, BoundedContextSchema, PortConfigurationSchema } from "@hexagen/project-configuration";
import yaml from "js-yaml";

/**
 * Parses a YAML manifest string into WizardData structure
 * @param yamlString - The YAML manifest string to parse
 * @returns WizardData object ready for form hydration
 * @throws Error if parsing fails or validation fails
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

  // Validate against the manifest schema
  const parseResult = ManifestSchema.safeParse(parsedManifest);
  if (!parseResult.success) {
    throw new Error(
      `Manifest validation failed: ${parseResult.error.errors
        .map((err) => err.message)
        .join(", ")}`,
    );
  }

  const manifest = parseResult.data;

  // Convert manifest to WizardData structure
  const wizardData: WizardData = {
    boundedContexts: manifest.bounded_contexts?.map((bc) => {
      // Validate each bounded context against the schema
      const bcParseResult = BoundedContextSchema.safeParse(bc);
      if (!bcParseResult.success) {
        // If validation fails, we still try to extract what we can
        console.warn("Bounded context validation warning:", bcParseResult.error);
      }
      
      const validatedBc = bcParseResult.success ? bcParseResult.data : bc;
      
         return {
          id: validatedBc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          name: validatedBc.name,
          description: validatedBc.description || "",
          infrastructureTarget: "nestjs",
          coreDomainEntities: validatedBc.layers?.domain?.entities ?? [],
          valueObjects: validatedBc.layers?.domain?.value_objects ?? [],
          domainEvents: [],
          apiFramework: undefined,
          uiFramework: "",
          persistenceAdapter: (() => {
            const adapter = validatedBc.layers?.infrastructure?.adapters?.[0];
            if (adapter === "Prisma" || adapter === "TypeORM" || adapter === "Mongoose" || adapter === "Drizzle") {
              return adapter;
            }
            return "";
          })(),
          messagingAdapter: (() => {
            const adapter = validatedBc.layers?.infrastructure?.adapters?.[1];
            if (adapter === "BullMQ" || adapter === "Temporal" || adapter === "RabbitMQ") {
              return adapter;
            }
            return "";
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
          portConfiguration: {
            inboundPorts: (validatedBc.layers?.application?.ports?.in as ("rest-controller" | "graphql-resolver" | "event-listener" | "cli-command")[]) ?? [],
            outboundPorts: (validatedBc.layers?.application?.ports?.out as ("relational-db" | "document-db" | "external-service-client" | "message-publisher")[]) ?? [],
          },
        };
     }) ?? [],
    externalContexts: [], // Not represented in current manifest schema
    peerMappings: [], // Not represented in current manifest schema
    governance: {
      workspaceName: manifest.system ?? "hexagen-project",
      workspaceTemplate: 
        manifest.architecture === "modular-monolith" || 
        manifest.architecture === "strict-enterprise" || 
        manifest.architecture === "micro-frontend"
          ? manifest.architecture
          : "modular-monolith",
      workspaceDescription: (typeof manifest.description === "string" ? manifest.description : undefined),
      packageManager: "yarn", // Default, not in manifest
      topologyStrictness: "flexible", // Default, not in manifest
      namespacePrefix: manifest.scope ?? "@hexagen",
      namingConventions: {
        contextDirectoryPattern: "packages/",
        adapterSuffix: ".adapter.ts",
      },
    },
  };

  return wizardData;
}