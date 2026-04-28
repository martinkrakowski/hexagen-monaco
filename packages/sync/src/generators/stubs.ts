// stubs.ts – stub-file generator for SyncEngine (Phase 1 of
// sync-engine-unified-scaffolding, Wave 2 Sub-agent 2a).
//
// Reads `generator.sync.stubs` from the manifest and, for a given bounded
// context, emits minimal TypeScript scaffold files for each declared layer
// element (entities, value objects, domain services, in/out ports for both
// the domain and application layers, application use cases, infrastructure
// adapters).
//
// Canonical safety invariant: this generator NEVER overwrites an existing
// file, regardless of `@generated` marker, `--force`, or `--force-root`.
// Users routinely turn stubs into real code by hand, and those edits must be
// preserved across reruns — including the external-mode rerun case where
// `force` is true. We enforce this with an explicit pre-existence check
// before delegating to `safeWriteFileAtomic`.

import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import { interpolate } from "../template-engine.js";
import type {
  BoundedContext,
  StubNaming,
  StubTemplates,
  StubsConfig,
} from "../types/manifest.js";
import {
  analyzePortFile,
  generateAdapterFromPort,
  generateUseCaseFromPort,
} from "./port-analyzer.js";

/**
 * Reporter shape matching the one used by sibling generators
 * (tsconfig / package-json). Kept as a local alias so this module does not
 * depend on the concrete `MigrationReport` class.
 */
type ReportRecorder = {
  record: (type: string, target: string, message: string) => void;
};

/**
 * Keys identifying every stub element type emitted by this generator.
 * The set is intentionally closed — adding a new element type requires a
 * manifest-type change and a new entry in both
 * {@link DEFAULT_TEMPLATES} and {@link DEFAULT_NAMING}.
 */
type StubKind =
  | "inPort"
  | "outPort"
  | "adapter"
  | "useCase"
  | "entity"
  | "valueObject"
  | "domainService";

/**
 * Built-in fallback template bodies, used when the manifest does not
 * declare a given `generator.sync.stubs.templates[kind]`. Each body carries
 * the `@generated ... stub — edit freely` marker so downstream tooling can
 * distinguish a pristine scaffold from a user-authored file, and so a
 * second run with identical content is reported as `unchanged`.
 *
 * Enhanced templates (Phase 1 - Agent-Friendly Scaffolding):
 * - Include proper TypeScript structure
 * - Add constructor DI patterns for classes
 * - Include JSDoc comments for documentation
 * - Provide method signature scaffolds
 * - Add type imports placeholders
 */
const DEFAULT_TEMPLATES: Required<StubTemplates> = {
  inPort: `// @generated in-port stub — edit freely
/**
 * {name}Port defines the contract for {name} operations.
 *
 * This is an inbound port in the Hexagonal Architecture pattern.
 * Implement this interface in your use case or domain service.
 */
export interface {name}Port {
  /**
   * TODO: Define your port methods here
   * Example:
   * execute(input: {name}Input): Promise<Result<{name}Output, Error>>;
   */
}
`,
  outPort: `// @generated out-port stub — edit freely
/**
 * {name}Port defines the contract for external {name} operations.
 *
 * This is an outbound port in the Hexagonal Architecture pattern.
 * Implement this interface in your infrastructure adapter.
 */
export interface {name}Port {
  /**
   * TODO: Define your port methods here
   * Example:
   * fetch(id: string): Promise<Result<{name}Data, Error>>;
   */
}
`,
  adapter: `// @generated adapter stub — edit freely
/**
 * {name}Adapter implements the {name}Port interface.
 *
 * This adapter connects your application to external systems/infrastructure.
 *
 * @example
 * const adapter = new {name}Adapter(dependencies);
 * const result = await adapter.execute(input);
 */
export class {name}Adapter {
  /**
   * Constructor with dependency injection.
   *
   * @param deps - Dependencies required by this adapter
   *
   * TODO: Define your dependencies
   * Example:
   * constructor(private readonly httpClient: HttpClientPort) {}
   */
  constructor() {
    // TODO: Initialize dependencies
  }

  /**
   * TODO: Implement port methods here
   * Example:
   * async execute(input: InputType): Promise<Result<OutputType, Error>> {
   *   // Implementation
   * }
   */
}
`,
  useCase: `// @generated use-case stub — edit freely
import type { Result } from '@hexagen/shared';

/**
 * {name}UseCase orchestrates the {name} business operation.
 *
 * This use case follows the Hexagonal Architecture pattern:
 * - Depends on ports (interfaces), not concrete implementations
 * - Contains business logic, not infrastructure concerns
 * - Returns Result<T, Error> for explicit error handling
 *
 * @example
 * const useCase = new {name}UseCase(dependencies);
 * const result = await useCase.execute(input);
 * if (result.success) {
 *   // Handle success
 * } else {
 *   // Handle error
 * }
 */
export class {name}UseCase {
  /**
   * Constructor with dependency injection.
   *
   * @param deps - Port dependencies (interfaces, not implementations)
   *
   * TODO: Define your port dependencies
   * Example:
   * constructor(
   *   private readonly repository: RepositoryPort,
   *   private readonly validator: ValidatorPort,
   * ) {}
   */
  constructor() {
    // TODO: Initialize dependencies
  }

  /**
   * Execute the use case.
   *
   * @param input - Use case input data
   * @returns Result containing output or error
   *
   * TODO: Define input/output types
   * Example:
   * async execute(input: {name}Input): Promise<Result<{name}Output, Error>> {
   *   // 1. Validate input
   *   // 2. Execute business logic
   *   // 3. Return result
   * }
   */
  async execute(input: unknown): Promise<Result<unknown, Error>> {
    // TODO: Implement use case logic
    return { success: false, error: new Error('Not implemented') };
  }
}
`,
  entity: `// @generated entity stub — edit freely
/**
 * {name} is a domain entity with identity and lifecycle.
 *
 * Domain entities:
 * - Have unique identity (ID)
 * - Contain business logic and invariants
 * - Are mutable (unlike value objects)
 * - Enforce domain rules in their methods
 *
 * @example
 * const entity = new {name}(id, props);
 * entity.performAction();
 */
export class {name} {
  /**
   * Constructor for {name} entity.
   *
   * @param id - Unique identifier
   * @param props - Entity properties
   *
   * TODO: Define your entity properties
   * Example:
   * constructor(
   *   private readonly id: string,
   *   private name: string,
   *   private status: Status,
   * ) {
   *   // Validate invariants
   * }
   */
  constructor(private readonly id: string) {
    // TODO: Initialize entity state
    // TODO: Validate invariants
  }

  /**
   * Get entity ID.
   */
  getId(): string {
    return this.id;
  }

  /**
   * TODO: Add domain methods here
   * Example:
   * performAction(): Result<void, Error> {
   *   // Validate business rules
   *   // Update state
   *   // Return result
   * }
   */
}
`,
  valueObject: `// @generated value-object stub — edit freely
/**
 * {name} is an immutable value object.
 *
 * Value objects:
 * - Are immutable (no setters)
 * - Are compared by value, not identity
 * - Contain validation logic
 * - Can be shared safely
 *
 * @example
 * const vo = {name}.create(rawValue);
 * if (vo.success) {
 *   // Use vo.value
 * }
 */
export class {name} {
  /**
   * Private constructor enforces factory pattern.
   * Use {name}.create() instead.
   */
  private constructor(private readonly value: unknown) {
    // Value is immutable after construction
  }

  /**
   * Factory method with validation.
   *
   * @param value - Raw value to wrap
   * @returns Result containing {name} or validation error
   *
   * TODO: Implement validation logic
   * Example:
   * static create(value: string): Result<{name}, Error> {
   *   if (!value || value.length === 0) {
   *     return { success: false, error: new Error('Value cannot be empty') };
   *   }
   *   return { success: true, value: new {name}(value) };
   * }
   */
  static create(value: unknown): { success: boolean; value?: {name}; error?: Error } {
    // TODO: Add validation
    return { success: true, value: new {name}(value) };
  }

  /**
   * Get the wrapped value.
   */
  getValue(): unknown {
    return this.value;
  }

  /**
   * Value objects are compared by value.
   */
  equals(other: {name}): boolean {
    return this.value === other.value;
  }
}
`,
  domainService: `// @generated domain-service stub — edit freely
/**
 * {name}Service encapsulates domain logic that doesn't belong to a single entity.
 *
 * Domain services:
 * - Contain stateless domain logic
 * - Operate on multiple entities/value objects
 * - Are part of the domain layer (no infrastructure)
 * - Express domain concepts that aren't natural entity methods
 *
 * @example
 * const service = new {name}Service(dependencies);
 * const result = service.performOperation(entity1, entity2);
 */
export class {name}Service {
  /**
   * Constructor with dependency injection.
   *
   * @param deps - Domain-layer dependencies (other services, factories)
   *
   * TODO: Define your dependencies
   * Example:
   * constructor(
   *   private readonly validator: ValidationService,
   *   private readonly factory: EntityFactory,
   * ) {}
   */
  constructor() {
    // TODO: Initialize dependencies
  }

  /**
   * TODO: Add domain service methods here
   * Example:
   * performOperation(entity1: Entity1, entity2: Entity2): Result<Output, Error> {
   *   // Domain logic that spans multiple entities
   * }
   */
}
`,
};

/**
 * Built-in fallback filename conventions, used when the manifest does not
 * declare a given `generator.sync.stubs.naming[kind]` (or when a per-context
 * `bounded_contexts[].generator.stubs.naming[kind]` is absent).
 *
 * Each value is a filename template interpolated with `{name}` at emission
 * time (e.g. `{name}.in-port.ts` → `UserCreatedPort.in-port.ts`).
 */
const DEFAULT_NAMING: Required<StubNaming> = {
  inPort: "{name}.in-port.ts",
  outPort: "{name}.out-port.ts",
  adapter: "{name}.adapter.ts",
  useCase: "{name}.use-case.ts",
  entity: "{name}.ts",
  valueObject: "{name}.vo.ts",
  domainService: "{name}.service.ts",
};

/**
 * Sub-directory (relative to the bounded context's `src/`) where each stub
 * kind is emitted. `inPort` and `outPort` appear twice in the emission
 * plan (once for `layers.domain.ports.*`, once for `layers.application.ports.*`)
 * and so are keyed by the emission site rather than the stub kind.
 */
type EmissionSite =
  | "domain/entities"
  | "domain/value-objects"
  | "domain/services"
  | "domain/ports/in"
  | "domain/ports/out"
  | "application/use-cases"
  | "application/ports/in"
  | "application/ports/out"
  | "infrastructure/adapters";

/**
 * Resolve a template body for the given stub kind. Prefers a manifest-declared
 * template; falls back to the built-in default. The returned string always
 * contains at least one `{name}` placeholder for downstream interpolation.
 */
function resolveTemplate(
  kind: StubKind,
  manifestTemplates: StubTemplates | undefined,
): string {
  return manifestTemplates?.[kind] ?? DEFAULT_TEMPLATES[kind];
}

/**
 * Resolve a filename template for the given stub kind. Cascade:
 *   1. per-context `bounded_contexts[].generator.stubs.naming[kind]`
 *   2. global `generator.sync.stubs.naming[kind]`
 *   3. built-in fallback {@link DEFAULT_NAMING}
 */
function resolveNaming(
  kind: StubKind,
  contextNaming: StubNaming | undefined,
  manifestNaming: StubNaming | undefined,
): string {
  return (
    contextNaming?.[kind] ?? manifestNaming?.[kind] ?? DEFAULT_NAMING[kind]
  );
}

/**
 * Produce an `{output, warnings}` pair by interpolating `{name}` into the
 * template, and forward any warnings to the logger with a `templateId` tag so
 * manifest-authoring mistakes surface clearly. `templateId` is something
 * like `"stubs.naming.inPort"` or `"stubs.templates.adapter"`.
 */
function interpolateWithLog(
  template: string,
  name: string,
  templateId: string,
  config: SyncConfig,
): string {
  const { output, warnings } = interpolate(template, { name });
  if (warnings.length > 0) {
    for (const missing of warnings) {
      config.logger.warn(`${templateId}: missing variable '${missing}'`);
    }
  }
  return output;
}

/**
 * Write a single stub file, preserving any file that already exists on disk
 * regardless of protection flags or `@generated` marker.
 *
 * The two-step approach — `fs.stat` existence check, then `safeWriteFileAtomic`
 * — is deliberate: `safeWriteFileAtomic` would overwrite a non-marker file
 * when `force === true`, and the stub generator's contract is stricter than
 * that (see module header).
 *
 * Returns the status string so the caller can aggregate it into the
 * `GeneratorResult` buckets.
 */
async function writeStubFile(
  filePath: string,
  content: string,
  config: SyncConfig,
  report: ReportRecorder | undefined,
): Promise<"created" | "updated" | "unchanged" | "skipped" | "protected"> {
  // Hard no-overwrite guard: if the file exists, skip it unconditionally.
  // This is stronger than safeWriteFileAtomic's own protection because it
  // holds even under --force / external-mode `force=true`.
  try {
    await fs.stat(filePath);
    // File exists — preserve it.
    const relative = path.relative(config.workspaceRoot, filePath);
    config.logger.debug(`stub preserved ${relative}`);
    if (report) {
      report.record(
        "skipped",
        filePath,
        "stub already exists — preserving user content",
      );
    }
    return "skipped";
  } catch (err) {
    if (
      !(err instanceof Error) ||
      (err as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      // Any error other than ENOENT is fatal (matches existing generator
      // style — fs errors bubble up to the engine's caller).
      throw err;
    }
  }

  // File absent — ensure the parent directory exists, then delegate to the
  // atomic writer. We pass `skipGeneratedCheck=false` so that if, between
  // our stat() and the rename, a hand-written non-generated file appears,
  // the inner protection still declines to overwrite it (belt and braces).
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  return safeWriteFileAtomic(filePath, content, config, report, false);
}

/**
 * Descriptor for a single emission site within a bounded context.
 * Flattens the layers object into a list of `(kind, subdir, names)` triples
 * so the main loop can iterate them uniformly.
 */
interface EmissionPlan {
  kind: StubKind;
  subdir: EmissionSite;
  names: string[];
}

/**
 * Build the ordered emission plan for a bounded context from its declared
 * layers. Returns an empty array if `context.layers` is missing — callers
 * should treat that as a no-op, not an error.
 */
function buildEmissionPlan(context: BoundedContext): EmissionPlan[] {
  const layers = context.layers;
  if (!layers) return [];

  const plan: EmissionPlan[] = [];

  const domain = layers.domain;
  if (domain) {
    if (domain.entities?.length) {
      plan.push({
        kind: "entity",
        subdir: "domain/entities",
        names: domain.entities,
      });
    }
    if (domain.value_objects?.length) {
      plan.push({
        kind: "valueObject",
        subdir: "domain/value-objects",
        names: domain.value_objects,
      });
    }
    // The DomainLayer type exposes only entities / value_objects / ports.
    // Domain services live under application in practice, but the spec
    // wires `layers.domain.domain_services` explicitly. Read it through an
    // index access so we do not require a manifest-type change here.
    const domainServices = (domain as unknown as { domain_services?: string[] })
      .domain_services;
    if (domainServices?.length) {
      plan.push({
        kind: "domainService",
        subdir: "domain/services",
        names: domainServices,
      });
    }
    if (domain.ports?.in?.length) {
      plan.push({
        kind: "inPort",
        subdir: "domain/ports/in",
        names: domain.ports.in,
      });
    }
    if (domain.ports?.out?.length) {
      plan.push({
        kind: "outPort",
        subdir: "domain/ports/out",
        names: domain.ports.out,
      });
    }
  }

  const application = layers.application;
  if (application) {
    if (application.use_cases?.length) {
      plan.push({
        kind: "useCase",
        subdir: "application/use-cases",
        names: application.use_cases,
      });
    }
    if (application.ports?.in?.length) {
      plan.push({
        kind: "inPort",
        subdir: "application/ports/in",
        names: application.ports.in,
      });
    }
    if (application.ports?.out?.length) {
      plan.push({
        kind: "outPort",
        subdir: "application/ports/out",
        names: application.ports.out,
      });
    }
  }

  const infrastructure = layers.infrastructure;
  if (infrastructure?.adapters?.length) {
    plan.push({
      kind: "adapter",
      subdir: "infrastructure/adapters",
      names: infrastructure.adapters,
    });
  }

  return plan;
}

/**
 * Try to find and analyze a related port file for an adapter or use case.
 *
 * For adapters: looks for the corresponding out-port
 * For use cases: looks for the corresponding in-port
 *
 * @param moduleDir - Package root directory
 * @param name - Adapter or use case name
 * @param kind - 'adapter' or 'useCase'
 * @param context - Bounded context
 * @returns Port analysis result or null if port file doesn't exist
 */
async function tryAnalyzeRelatedPort(
  moduleDir: string,
  name: string,
  kind: "adapter" | "useCase",
  context: BoundedContext,
): Promise<ReturnType<typeof analyzePortFile>> {
  // Determine which port to look for
  const portType = kind === "adapter" ? "out" : "in";
  const portSubdir = `application/ports/${portType}`;

  // Try to find a matching port name
  // Convention: FooAdapter implements FooPort, FooUseCase implements FooPort
  const portName = name.replace(/Adapter$|UseCase$/, "Port");

  // Check if this port is declared in the manifest
  const declaredPorts =
    portType === "in"
      ? context.layers?.application?.ports?.in || []
      : context.layers?.application?.ports?.out || [];

  if (!declaredPorts.includes(portName)) {
    return null;
  }

  // Try to find the port file
  // Common naming patterns: FooPort.in-port.ts, foo-port.in-port.ts, FooPort.ts
  const possibleFilenames = [
    `${portName}.${portType}-port.ts`,
    `${portName.toLowerCase()}.${portType}-port.ts`,
    `${portName}.ts`,
  ];

  for (const filename of possibleFilenames) {
    const portFilePath = path.join(moduleDir, "src", portSubdir, filename);
    const analysis = analyzePortFile(portFilePath);
    if (analysis) {
      return analysis;
    }
  }

  return null;
}

/**
 * Generate stub scaffold files for a single bounded context.
 *
 * This is an opt-in generator: it no-ops unless the manifest declares
 * `generator.sync.stubs.enabled === true`. This matches Phase 1 of the
 * `sync-engine-unified-scaffolding` plan, which introduces stub scaffolding
 * into the engine without changing behavior for existing manifests.
 *
 * For the declared bounded context, every layer-element name triggers one
 * file emission at `src/<layer-subdir>/<naming-template>`, with the file
 * body computed from the matching stub template. Each template is
 * interpolated with `{name}` (the element name) via the shared
 * `template-engine`. Missing-variable warnings are surfaced through the
 * logger but are not fatal.
 *
 * Safety:
 *   - NEVER overwrites an existing file, even under `--force`. See
 *     {@link writeStubFile}.
 *   - Returns `skipped` (not an error) when the manifest is missing stubs
 *     configuration, when `stubs.enabled !== true`, when the bounded
 *     context is not declared, or when `layers` is undefined.
 *   - Filesystem errors bubble up per sibling generator convention
 *     (fatal for the engine's caller).
 *
 * @param moduleDir  - Absolute path of the bounded context package (e.g.
 *   `/.../packages/<name>`). Stubs are emitted under `<moduleDir>/src/...`.
 * @param moduleName - The bounded context name used to look up declarations
 *   in `config.manifest.bounded_contexts`.
 * @param config     - Sync runtime config (manifest, logger, flags).
 * @param report     - Optional migration-report recorder for diagnostic output.
 * @returns A {@link GeneratorResult} aggregating every per-file status.
 */
export async function generateStubs(
  moduleDir: string,
  moduleName: string,
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();

  const stubs: StubsConfig | undefined = config.manifest.generator?.sync?.stubs;

  // Strict opt-in: section must exist AND enabled must be explicitly true.
  if (!stubs || stubs.enabled !== true) {
    return result;
  }

  const context = config.manifest.bounded_contexts?.find(
    (c) => c.name === moduleName,
  );
  if (!context) {
    // No bounded context declared — nothing to emit. Not an error.
    config.logger.debug(
      `generateStubs: no bounded context named '${moduleName}' in manifest`,
    );
    return result;
  }

  const plan = buildEmissionPlan(context);
  if (plan.length === 0) {
    config.logger.debug(
      `generateStubs: no layer declarations for '${moduleName}'`,
    );
    return result;
  }

  const manifestTemplates = stubs.templates;
  const manifestNaming = stubs.naming;
  const contextNaming = context.generator?.stubs?.naming;

  for (const { kind, subdir, names } of plan) {
    const contentTemplate = resolveTemplate(kind, manifestTemplates);
    const namingTemplate = resolveNaming(kind, contextNaming, manifestNaming);

    for (const name of names) {
      const filename = interpolateWithLog(
        namingTemplate,
        name,
        `stubs.naming.${kind}`,
        config,
      );

      let content: string;

      // Try to generate from port analysis for adapters and use cases
      if (kind === "adapter" || kind === "useCase") {
        const portAnalysis = await tryAnalyzeRelatedPort(
          moduleDir,
          name,
          kind,
          context,
        );

        if (portAnalysis) {
          // Generate from port analysis
          if (kind === "adapter") {
            content = generateAdapterFromPort(portAnalysis, name);
          } else {
            // For use cases, find related out-ports
            const outPorts = context.layers?.application?.ports?.out || [];
            content = generateUseCaseFromPort(portAnalysis, name, outPorts);
          }
          config.logger.debug(`Generated ${kind} '${name}' from port analysis`);
        } else {
          // Fall back to template
          content = interpolateWithLog(
            contentTemplate,
            name,
            `stubs.templates.${kind}`,
            config,
          );
        }
      } else {
        // Use template for other kinds
        content = interpolateWithLog(
          contentTemplate,
          name,
          `stubs.templates.${kind}`,
          config,
        );
      }

      const filePath = path.join(moduleDir, "src", subdir, filename);
      const status = await writeStubFile(filePath, content, config, report);

      if (status === "created") result.created.push(filePath);
      if (status === "updated") result.updated.push(filePath);
      if (status === "skipped" || status === "protected")
        result.skipped.push(filePath);
      if (status === "created" || status === "updated") result.totalOps += 1;
    }
  }

  return result;
}
