const LAYER_RULES_COMMON = `shared_kernel:
  package: "@{scope}/shared"
  allowed_in_all_layers: true

layers:
  domain:
    access_rule: "internal-only"
    allowed_imports: ["@{scope}/shared"]

  application:
    access_rule: "ports-only"
    allowed_imports: ["domain", "@{scope}/shared"]

  infrastructure:
    access_rule: "adapters"
    allowed_imports: ["domain", "application", "@{scope}/shared"]
`;

const LAYER_RULES_STRICT_ENTERPRISE = `# HexaGen — Architectural Invariants
# Template: strict-enterprise — event-bus boundaries

${LAYER_RULES_COMMON}
cross_context:
  deny_direct_imports: true
  required_communication: "event-bus"
  allowed_broker_patterns:
    - "event-bus"
    - "message-queue"
`;

const LAYER_RULES_MICRO_FRONTEND = `# HexaGen — Architectural Invariants
# Template: micro-frontend — networked boundaries

${LAYER_RULES_COMMON}
cross_context:
  deny_direct_imports: true
  required_communication: "network"
  allowed_broker_patterns:
    - "network-rpc"
    - "http-api"
`;

const LAYER_RULES_DEFAULT = `# HexaGen — Architectural Invariants
# Template: {template} (flexible mode)

${LAYER_RULES_COMMON}`;

const LINTER_CONFIG_STRICT = `# Rules for @hexagen-monaco/arch-linter
# Template: {template} (strict mode)

global_whitelist:
  - "@{scope}/shared"
  - "@{scope}/shared/**"

cross_context_rules:
  deny_sibling_imports: true
  require_port_interface: true

test_double_rules:
  allowed_cross_package_imports: true
`;

const LINTER_CONFIG_DEFAULT = `# Rules for @hexagen-monaco/arch-linter
# Template: {template} (flexible mode)

global_whitelist:
  - "@{scope}/shared"
  - "@{scope}/shared/**"

test_double_rules:
  allowed_cross_package_imports: true
`;

const GENERATOR_CONFIG_TEMPLATE = `generator:
  version: "1.0"
  description: "Global invariants and safety rules"
  workspace_template: "{workspaceTemplate}"

  invariants:
    - name: composite-safety
      description: "Every tsconfig.json must contain paths: {{}} to override inherited source mappings."
      priority: critical
      failure: abort-and-cleanup

    - name: barrel-ownership-boundary
      description: "Barrels may only re-export types owned by the current bounded context."
      priority: critical
      failure: abort-and-cleanup

    - name: port-single-ownership
      description: "Each port interface belongs to exactly one bounded context."
      priority: critical
      failure: abort-and-cleanup

    - name: dependency-consistency
      description: "Every @{scope}/* import must have a matching entry in package.json."
      priority: high
      failure: abort

    - name: self-import-prevention
      description: "No package imports itself by name."
      priority: high
      failure: abort

    - name: signature-synchronization
      description: "Generated consumers must derive exact signatures from the canonical port."
      priority: high
      failure: abort

    - name: no-empty-stubs
      description: "No empty barrels (export {{}}) in src/."
      priority: medium
      failure: warn-and-continue

    - name: exports-field-mandatory
      description: "Every package.json must include a complete exports map."
      priority: medium
      failure: warn-and-continue

    - name: test-double-parity
      description: "Test doubles must implement the same interface as the canonical port."
      priority: medium
      failure: warn-and-continue

  bootstrap-sequence:
    - load-ownership-map
    - validate-port-ownership-map
    - generate-package-skeleton
    - enforce-tsconfig-paths-override
    - generate-exports-field
    - synchronize-signatures
    - validate-barrel-chain
    - enforce-dependency-consistency
    - final-composite-reference-check

  failure-behavior:
    critical: abort-and-cleanup
    high: abort
    medium: warn-and-continue

  ownership-registry:
    ports:
{ownershipBlock}
`;

export {
  LAYER_RULES_COMMON,
  LAYER_RULES_STRICT_ENTERPRISE,
  LAYER_RULES_MICRO_FRONTEND,
  LAYER_RULES_DEFAULT,
  LINTER_CONFIG_STRICT,
  LINTER_CONFIG_DEFAULT,
  GENERATOR_CONFIG_TEMPLATE,
};
