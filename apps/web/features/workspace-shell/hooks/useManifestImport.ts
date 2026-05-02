import { useCallback } from "react";
import yaml from "js-yaml";
import { buildWizardData } from "@hexagen/wizard-orchestration";
import type {
  ProjectConfig,
  WizardData,
  BoundedContext,
} from "@hexagen/project-configuration";
import { emptyFormValues } from "../../project-wizard/config";

export type ManifestImportOutcome =
  | { kind: "success"; wizardData: WizardData; formValues: ProjectConfig }
  | { kind: "parse-error"; message: string };

export interface UseManifestImportReturn {
  importManifest: (yamlContent: string) => Promise<ManifestImportOutcome>;
}

type RawManifest = Record<string, unknown>;
type RawContext = Record<string, unknown>;

function mapInboundPortName(
  name: string,
): "rest-controller" | "graphql-resolver" | "event-listener" | "cli-command" {
  const lower = name.toLowerCase();
  if (
    lower.includes("graphql") ||
    lower.includes("resolver") ||
    lower.includes("query")
  )
    return "graphql-resolver";
  if (
    lower.includes("event") ||
    lower.includes("subscriber") ||
    lower.includes("listener")
  )
    return "event-listener";
  if (
    lower.includes("cli") ||
    lower.includes("command") ||
    lower.includes("handler")
  )
    return "cli-command";
  return "rest-controller";
}

function mapOutboundPortName(
  name: string,
):
  | "relational-db"
  | "document-db"
  | "external-service-client"
  | "message-publisher" {
  const lower = name.toLowerCase();
  if (
    lower.includes("mongo") ||
    lower.includes("document") ||
    lower.includes("dynamo")
  )
    return "document-db";
  if (
    lower.includes("client") ||
    lower.includes("gateway") ||
    lower.includes("http") ||
    lower.includes("service")
  )
    return "external-service-client";
  if (
    lower.includes("publisher") ||
    lower.includes("message") ||
    lower.includes("queue") ||
    lower.includes("broker")
  )
    return "message-publisher";
  return "relational-db";
}

function translateContext(raw: RawContext): BoundedContext {
  const name = String(raw.name ?? "unknown");
  const description = raw.description ? String(raw.description) : "";

  let inboundPorts: Array<
    "rest-controller" | "graphql-resolver" | "event-listener" | "cli-command"
  > = [];
  let outboundPorts: Array<
    | "relational-db"
    | "document-db"
    | "external-service-client"
    | "message-publisher"
  > = [];

  const camelPorts = raw.ports as Record<string, unknown> | undefined;
  if (camelPorts) {
    const inArr = (camelPorts.in ?? []) as Array<{ name?: string } | string>;
    const outArr = (camelPorts.out ?? []) as Array<{ name?: string } | string>;
    inboundPorts = inArr.map((p) =>
      typeof p === "string"
        ? mapInboundPortName(p)
        : mapInboundPortName(p.name ?? ""),
    );
    outboundPorts = outArr.map((p) =>
      typeof p === "string"
        ? mapOutboundPortName(p)
        : mapOutboundPortName(p.name ?? ""),
    );
  }

  const layers = raw.layers as Record<string, unknown> | undefined;
  if (layers) {
    const app = layers.application as Record<string, unknown> | undefined;
    if (app) {
      const ports = app.ports as Record<string, unknown> | undefined;
      if (ports) {
        const inNames = (ports.in ?? []) as string[];
        const outNames = (ports.out ?? []) as string[];
        if (inNames.length > 0) inboundPorts = inNames.map(mapInboundPortName);
        if (outNames.length > 0)
          outboundPorts = outNames.map(mapOutboundPortName);
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    name,
    description,
    infrastructureTarget: "nestjs",
    coreDomainEntities: [],
    valueObjects: [],
    domainEvents: [],
    entities: [],
    useCases: [],
    portConfiguration: {
      inboundPorts: [...new Set(inboundPorts)],
      outboundPorts: [...new Set(outboundPorts)],
    },
    uiFramework: "",
    persistenceAdapter: "",
    messagingAdapter: "",
    telemetryProvider: "",
  };
}

export function useManifestImport(): UseManifestImportReturn {
  const importManifest = useCallback(
    async (yamlContent: string): Promise<ManifestImportOutcome> => {
      try {
        const manifest = yaml.load(yamlContent) as RawManifest;

        const rawContexts = (manifest.boundedContexts ??
          manifest.bounded_contexts ??
          []) as RawContext[];
        const boundedContexts = rawContexts.map(translateContext);

        const formValues: ProjectConfig = {
          boundedContexts,
          externalContexts:
            (manifest.externalContexts as ProjectConfig["externalContexts"]) ??
            [],
          peerMappings:
            (manifest.peerMappings as ProjectConfig["peerMappings"]) ?? [],
          governance:
            (manifest.governance as ProjectConfig["governance"]) ??
            emptyFormValues.governance,
        };

        const wizardData = buildWizardData(
          formValues.boundedContexts,
          formValues.externalContexts,
          formValues.peerMappings,
          formValues.governance,
        );

        return {
          kind: "success",
          wizardData,
          formValues,
        };
      } catch (error) {
        return {
          kind: "parse-error",
          message: error instanceof Error ? error.message : "Parse error",
        };
      }
    },
    [],
  );

  return { importManifest };
}
