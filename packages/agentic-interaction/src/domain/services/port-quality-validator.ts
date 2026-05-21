import type { PortDefinition } from "../value-objects/pipeline-state";

export interface PortQualityIssue {
  portName: string;
  contextName: string;
  severity: "error" | "warning";
  rule: string;
  message: string;
}

const MIN_DESCRIPTION_LENGTH = 10;
const MIN_JUSTIFICATION_LENGTH = 10;

const PLATFORM_TOKENS = [
  "Vercel",
  "FlyIO",
  "AWS",
  "GCP",
  "Azure",
  "Heroku",
  "Render",
  "Railway",
  "DigitalOcean",
  "Netlify",
  "Cloudflare",
];

const INFRASTRUCTURE_SUFFIX_RE = /(Client|Adapter|Host|Platform)(Port)?$/i;

function toNormalizedTokens(name: string): string[] {
  return name
    .replace(/Port$/i, "")
    .split(/(?=[A-Z])|[-_]/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

function isSubstringOfName(text: string, name: string): boolean {
  const lowerText = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lowerName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return lowerName.includes(lowerText) || lowerText.includes(lowerName);
}

function checkTrivialDescription(
  port: PortDefinition,
  contextName: string,
): PortQualityIssue | null {
  if (
    port.description.length < MIN_DESCRIPTION_LENGTH ||
    isSubstringOfName(port.description, port.name)
  ) {
    return {
      portName: port.name,
      contextName,
      severity: "warning",
      rule: "R16",
      message: `Port description is trivial: "${port.description}"`,
    };
  }
  return null;
}

function checkInvalidForAggregate(
  port: PortDefinition,
  contextName: string,
  aggregateRoots: string[],
): PortQualityIssue | null {
  if (port.forAggregate && !aggregateRoots.includes(port.forAggregate)) {
    return {
      portName: port.name,
      contextName,
      severity: "error",
      rule: "R17",
      message: `Port forAggregate "${port.forAggregate}" is not a known aggregate root`,
    };
  }
  return null;
}

function checkDegenerateJustification(
  port: PortDefinition,
  contextName: string,
): PortQualityIssue | null {
  if (port.justification === undefined) {
    return null;
  }
  if (
    port.justification.length < MIN_JUSTIFICATION_LENGTH ||
    isSubstringOfName(port.justification, port.name)
  ) {
    return {
      portName: port.name,
      contextName,
      severity: "warning",
      rule: "R16",
      message: `Port justification is degenerate: "${port.justification}"`,
    };
  }
  return null;
}

function checkInfrastructureName(
  port: PortDefinition,
  contextName: string,
): PortQualityIssue | null {
  if (!INFRASTRUCTURE_SUFFIX_RE.test(port.name)) {
    return null;
  }
  const nameContainsPlatform = PLATFORM_TOKENS.some((token) =>
    port.name.toLowerCase().includes(token.toLowerCase()),
  );
  if (nameContainsPlatform) {
    return {
      portName: port.name,
      contextName,
      severity: "error",
      rule: "R18",
      message: `Port name "${port.name}" leaks infrastructure/platform metadata (regex match)`,
    };
  }
  return null;
}

function checkRuntimeConcernLeak(
  port: PortDefinition,
  contextName: string,
  runtimeConcerns: string[],
): PortQualityIssue | null {
  const portTokens = toNormalizedTokens(port.name);
  for (const concern of runtimeConcerns) {
    const concernTokens = concern
      .toLowerCase()
      .split(/[-_\s.]+/)
      .filter(Boolean);
    const match = concernTokens.some(
      (ct) => ct.length >= 3 && portTokens.some((pt) => pt === ct),
    );
    if (match) {
      return {
        portName: port.name,
        contextName,
        severity: "error",
        rule: "R18",
        message: `Port name "${port.name}" leaks runtime concern "${concern}"`,
      };
    }
  }
  return null;
}

export function validatePortQuality(
  ports: PortDefinition[],
  contextName: string,
  aggregateRoots: string[],
  runtimeConcerns?: string[],
): PortQualityIssue[] {
  const issues: PortQualityIssue[] = [];

  for (const port of ports) {
    const trivial = checkTrivialDescription(port, contextName);
    if (trivial) issues.push(trivial);

    const forAgg = checkInvalidForAggregate(port, contextName, aggregateRoots);
    if (forAgg) issues.push(forAgg);

    const degen = checkDegenerateJustification(port, contextName);
    if (degen) issues.push(degen);

    const infra = checkInfrastructureName(port, contextName);
    if (infra) issues.push(infra);

    if (runtimeConcerns) {
      const leak = checkRuntimeConcernLeak(port, contextName, runtimeConcerns);
      if (leak) issues.push(leak);
    }
  }

  return issues;
}
