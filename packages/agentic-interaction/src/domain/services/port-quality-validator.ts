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
  if (!port.forAggregate || aggregateRoots.includes(port.forAggregate)) {
    return null;
  }
  // The context has NO known aggregate roots — the spec declared none and domain
  // extraction produced none. A forAggregate then can't be checked against a
  // known set, so it's ADVISORY, not a hard error: treating it as an error
  // turned every contexts-but-no-aggregates import into a flood of ~1-per-port
  // R17 failures (the manifest is still produced and usable). When the context
  // DOES have aggregate roots, a forAggregate that isn't one of them is a genuine
  // hallucination and stays an error.
  if (aggregateRoots.length === 0) {
    return {
      portName: port.name,
      contextName,
      severity: "warning",
      rule: "R17",
      message: `Port forAggregate "${port.forAggregate}" can't be validated — context '${contextName}' declares no aggregate roots`,
    };
  }
  return {
    portName: port.name,
    contextName,
    severity: "error",
    rule: "R17",
    message: `Port forAggregate "${port.forAggregate}" is not a known aggregate root`,
  };
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

/** True iff `needle` appears as a contiguous, in-order run within `haystack`. */
function containsContiguousRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * A port "leaks" a runtime concern only when it is NAMED AFTER it: a contiguous,
 * in-order run of at least min(2, |concern|) of the concern's tokens appears in
 * the port-name tokens. This flags ports named after a worker responsibility
 * (`EmailRetryPort` ← email-retry, `OverdueInvoiceDetectionPort` ←
 * overdue-invoice-detection) while NOT flagging domain ports that merely share a
 * single noun with a MULTI-WORD concern (`CreateInvoicePort` vs
 * "overdue-invoice-detection", every `*EventPublisher` vs "event-bus") — the
 * old "any single shared token" rule produced those false positives.
 */
function portNamedAfterConcern(
  portTokens: string[],
  concernTokens: string[],
): boolean {
  const windowSize = Math.min(2, concernTokens.length);
  for (let s = 0; s + windowSize <= concernTokens.length; s++) {
    if (
      containsContiguousRun(portTokens, concernTokens.slice(s, s + windowSize))
    )
      return true;
  }
  return false;
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
      .filter((t) => t.length >= 3);
    if (concernTokens.length === 0) continue;
    if (portNamedAfterConcern(portTokens, concernTokens)) {
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
