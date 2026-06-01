/**
 * Built-in fallback template bodies for stub generation.
 * Used when the manifest does not declare a given `generator.sync.stubs.templates[kind]`.
 */

import type { StubTemplates, StubNaming } from "../types/manifest.js";

export const DEFAULT_TEMPLATES: Required<StubTemplates> = {
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
import type { Result } from '@{scope}/shared';

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

export const DEFAULT_NAMING: Required<StubNaming> = {
  inPort: "{name}.in-port.ts",
  outPort: "{name}.out-port.ts",
  adapter: "{name}.adapter.ts",
  useCase: "{name}.use-case.ts",
  entity: "{name}.ts",
  valueObject: "{name}.vo.ts",
  domainService: "{name}.service.ts",
};
