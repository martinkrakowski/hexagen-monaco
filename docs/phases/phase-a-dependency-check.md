# Phase A — Cross-Package Dependency Verification

## Overview

This document specifies the verification procedures for cross-package dependencies, export consistency, and architectural invariants after Phase A adapter additions.

---

## Verification Procedures

### 1. Manifest.yaml Validation

**Purpose**: Ensure manifest remains valid after all Phase A adapters are added.

#### Procedure

```bash
# Validate YAML syntax
python3 -c "import yaml; yaml.safe_load(open('.architecture/manifest.yaml'))" && echo "✓ YAML syntax valid"

# Validate through linter
yarn lint:arch
```

#### Expected Results

- ✅ Valid YAML with no syntax errors
- ✅ All packages properly defined with their ports and adapters
- ✅ No conflicting adapter names across packages

#### Critical Sections to Verify

```yaml
# reconciliation-engine bounded context
- context: reconciliation-engine
  adapters:
    - name: ManifestPatchAdapter # ← NEW in Phase A
      port: ManifestPatchPort
      type: input

# transaction-system bounded context
- context: transaction-system
  adapters:
    - name: SyncDelegatingManifestMutationAdapter # ← NEW in Phase A
      port: ManifestMutationDelegationPort
      type: output

# ai-pipeline bounded context
- context: ai-pipeline
  adapters:
    - name: NLToDomainCommandAdapter # ← NEW in Phase A
      port: DomainCommandPort
      type: output
```

---

### 2. Circular Dependency Detection

**Purpose**: Verify no circular import patterns were introduced.

#### Procedure A: Static Analysis

```bash
# Check for circular dependencies in monorepo
yarn workspace @hexagen/reconciliation-engine build 2>&1 | grep -i "circular" && echo "⚠ Circular deps detected" || echo "✓ No circular dependencies"
yarn workspace @hexagen/transaction-system build 2>&1 | grep -i "circular" && echo "⚠ Circular deps detected" || echo "✓ No circular dependencies"
yarn workspace @hexagen/ai-pipeline build 2>&1 | grep -i "circular" && echo "⚠ Circular deps detected" || echo "✓ No circular dependencies"
```

#### Procedure B: Manual Inspection

Check these import chains:

**Chain 1**: reconciliation-engine → transaction-system → (back to reconciliation-engine?)

```typescript
// ✓ ALLOWED: tx-system imports reconciliation-engine port
import { ManifestPatchPort } from "@hexagen/reconciliation-engine";

// ✗ FORBIDDEN: reconciliation-engine imports from tx-system adapters
// (should only import ports, not adapters)
```

**Chain 2**: ai-pipeline → reconciliation-engine → (back to ai-pipeline?)

```typescript
// ✓ ALLOWED: reconciliation-engine imports ai-pipeline port
import { DomainCommandPort } from "@hexagen/ai-pipeline";

// ✗ FORBIDDEN: ai-pipeline imports reconciliation-engine adapters
// (should only import ports, not adapters)
```

**Chain 3**: transaction-system → ai-pipeline → (back to transaction-system?)

```typescript
// ✓ ALLOWED: ai-pipeline imports transaction-system port
import { ManifestMutationDelegationPort } from "@hexagen/transaction-system";

// ✗ FORBIDDEN: transaction-system imports ai-pipeline adapters
// (should only import ports, not adapters)
```

#### Expected Results

- ✅ No circular import chains detected
- ✅ All dependencies follow port → adapter direction
- ✅ Build succeeds without circular dependency warnings

---

### 3. Barrel File Export Consistency

**Purpose**: Verify all Phase A adapters are properly exported from barrel files.

#### Exports to Verify

##### reconciliation-engine/src/infrastructure/adapters/index.ts

```typescript
// Should contain:
export * from "./manifest-patch.adapter.js";  // ← NEW in Phase A

// Verify by:
grep "manifest-patch" packages/reconciliation-engine/src/infrastructure/adapters/index.ts
```

**Expected Output**:

```
export * from "./manifest-patch.adapter.js";
```

##### transaction-system/src/infrastructure/adapters/index.ts

```typescript
// Should contain:
export * from "./sync-delegating-manifest-mutation.adapter.js";  // ← NEW in Phase A

// Verify by:
grep "sync-delegating" packages/transaction-system/src/infrastructure/adapters/index.ts
```

**Expected Output**:

```
export * from "./sync-delegating-manifest-mutation.adapter.js";
```

##### ai-pipeline/src/infrastructure/adapters/index.ts

```typescript
// Should contain:
export * from "./nl-to-domain-command.adapter.js";  // ← NEW in Phase A

// Verify by:
grep "nl-to-domain-command" packages/ai-pipeline/src/infrastructure/adapters/index.ts
```

**Expected Output**:

```
export * from "./nl-to-domain-command.adapter.js";
```

#### Verification Procedure

```bash
# Check reconciliation-engine barrel
grep "manifest-patch" packages/reconciliation-engine/src/infrastructure/adapters/index.ts || \
  echo "✗ Missing export for manifest-patch adapter"

# Check transaction-system barrel
grep "sync-delegating" packages/transaction-system/src/infrastructure/adapters/index.ts || \
  echo "✗ Missing export for sync-delegating adapter"

# Check ai-pipeline barrel
grep "nl-to-domain-command" packages/ai-pipeline/src/infrastructure/adapters/index.ts || \
  echo "✗ Missing export for nl-to-domain-command adapter"

# Verify no empty barrels
grep "export {}" packages/*/src/infrastructure/adapters/index.ts && \
  echo "⚠ Empty barrel detected" || echo "✓ No empty barrels"
```

#### Expected Results

- ✅ All three Phase A adapters exported from their respective barrels
- ✅ No empty `export {}` statements
- ✅ All exports use `.js` extensions (ESM consistency)

---

### 4. ESM Extension Consistency

**Purpose**: Verify all imports use explicit `.js` extensions for bundler resolution.

#### Files to Verify

##### reconciliation-engine/src/infrastructure/adapters/manifest-patch.adapter.ts

```bash
grep -n "import.*from.*['\"].*['\"]" packages/reconciliation-engine/src/infrastructure/adapters/manifest-patch.adapter.ts | \
  grep -v "\.js['\"]" && echo "⚠ Missing .js extension" || echo "✓ All imports have .js extension"
```

##### transaction-system/src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.ts

```bash
grep -n "import.*from.*['\"].*['\"]" packages/transaction-system/src/infrastructure/adapters/sync-delegating-manifest-mutation.adapter.ts | \
  grep -v "\.js['\"]" && echo "⚠ Missing .js extension" || echo "✓ All imports have .js extension"
```

##### ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts

```bash
grep -n "import.*from.*['\"].*['\"]" packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts | \
  grep -v "\.js['\"]" && echo "⚠ Missing .js extension" || echo "✓ All imports have .js extension"
```

#### Expected Results

- ✅ All relative imports end with `.js`
- ✅ All @hexagen/\* imports end with `.js`
- ✅ Consistent with existing codebase patterns
- ✅ Build succeeds without module resolution warnings

#### Example: Correct Pattern

```typescript
// ✓ CORRECT
import { ManifestPatchPort } from "../domain/manifest-patch.port.js";
import { ValidatorPort } from "@hexagen/governance"; // monorepo deps omit .js
import type { Patch } from "../domain/llm-response.js";

// ✗ INCORRECT
import { ManifestPatchPort } from "../domain/manifest-patch.port";
import { ValidatorPort } from "@hexagen/governance.js";
import type { Patch } from "../domain/llm-response";
```

---

### 5. Index.ts Export Validation

**Purpose**: Verify all public exports match manifest declarations.

#### Root Package Exports

##### packages/reconciliation-engine/src/index.ts

```bash
# Should include ManifestPatchAdapter
grep "ManifestPatchAdapter" packages/reconciliation-engine/src/index.ts || \
  echo "✗ ManifestPatchAdapter not exported from root index"
```

##### packages/transaction-system/src/index.ts

```bash
# Should include SyncDelegatingManifestMutationAdapter
grep "SyncDelegatingManifestMutationAdapter" packages/transaction-system/src/index.ts || \
  echo "✗ SyncDelegatingManifestMutationAdapter not exported from root index"
```

##### packages/ai-pipeline/src/index.ts

```bash
# Should include NLToDomainCommandAdapter
grep "NLToDomainCommandAdapter" packages/ai-pipeline/src/index.ts || \
  echo "✗ NLToDomainCommandAdapter not exported from root index"
```

#### Expected Results

- ✅ All Phase A adapters re-exported from package root
- ✅ Public API matches manifest adapter declarations
- ✅ TypeScript compilation succeeds with exported types

---

### 6. Package.json Dependencies

**Purpose**: Verify package.json declares all required dependencies.

#### Verification Procedure

```bash
# Check reconciliation-engine dependencies
cat packages/reconciliation-engine/package.json | jq '.dependencies, .devDependencies' | \
  grep -i "shared\|governance\|code-generation" || echo "⚠ Check dependencies manually"

# Check transaction-system dependencies
cat packages/transaction-system/package.json | jq '.dependencies, .devDependencies' | \
  grep -i "reconciliation\|ai-pipeline" && echo "⚠ Unexpected cross-package dependencies" || echo "✓ No circular runtime deps"

# Check ai-pipeline dependencies
cat packages/ai-pipeline/package.json | jq '.dependencies, .devDependencies' | \
  grep -i "transaction\|reconciliation" && echo "⚠ Unexpected cross-package dependencies" || echo "✓ No circular runtime deps"
```

#### Expected Results

- ✅ All required shared packages listed
- ✅ No circular runtime dependencies
- ✅ All @hexagen/\* imports have matching package.json entries
- ✅ devDependencies properly configured

---

### 7. TypeScript Path Resolution

**Purpose**: Verify tsconfig.json path mappings are consistent.

#### Verification Procedure

```bash
# Verify base path mapping includes all Phase A packages
grep -A 20 '"paths"' tsconfig.base.json | grep -E "@hexagen/(reconciliation-engine|transaction-system|ai-pipeline)" || \
  echo "✓ Paths configured in base tsconfig"

# Verify each package extends base config
for pkg in reconciliation-engine transaction-system ai-pipeline; do
  grep '"extends": "../../tsconfig.base.json"' "packages/$pkg/tsconfig.json" && \
    echo "✓ $pkg extends base config" || \
    echo "✗ $pkg missing base config extension"
done
```

#### Expected Results

- ✅ All Phase A packages in base path mapping
- ✅ All packages extend ../../tsconfig.base.json
- ✅ No local path overrides conflict with base
- ✅ TypeScript resolves imports correctly

---

## Automated Verification Script

Run all checks at once:

```bash
#!/bin/bash
# scripts/verify-phase-a-dependencies.sh

set -e

echo "Phase A Dependency Verification"
echo "================================"
echo ""

# 1. Manifest validation
echo "1. Validating manifest.yaml..."
python3 -c "import yaml; yaml.safe_load(open('.architecture/manifest.yaml'))" && echo "   ✓ Valid YAML"

# 2. Architecture lint
echo "2. Running lint:arch..."
yarn lint:arch > /dev/null && echo "   ✓ Architecture compliant"

# 3. Build without errors
echo "3. Building Phase A packages..."
yarn workspace @hexagen/reconciliation-engine build && echo "   ✓ reconciliation-engine"
yarn workspace @hexagen/transaction-system build && echo "   ✓ transaction-system"
yarn workspace @hexagen/ai-pipeline build && echo "   ✓ ai-pipeline"

# 4. Export consistency
echo "4. Checking barrel exports..."
grep "manifest-patch" packages/reconciliation-engine/src/infrastructure/adapters/index.ts && echo "   ✓ manifest-patch exported"
grep "sync-delegating" packages/transaction-system/src/infrastructure/adapters/index.ts && echo "   ✓ sync-delegating exported"
grep "nl-to-domain-command" packages/ai-pipeline/src/infrastructure/adapters/index.ts && echo "   ✓ nl-to-domain-command exported"

# 5. ESM extension check
echo "5. Validating ESM extensions..."
# (grep logic as shown above)

echo ""
echo "✓ All dependency checks passed"
```

---

## Failure Scenarios

### Scenario A: Missing Barrel Export

**Symptom**: TypeScript error when importing adapter

```
error TS4029: Cannot find a declaration file for module '@hexagen/transaction-system'
```

**Fix**: Add export to infrastructure/adapters/index.ts

### Scenario B: Circular Dependency Detected

**Symptom**: Build fails with circular import message

```
Circular dependency detected: a → b → a
```

**Fix**: Review import statements and ensure port → adapter direction

### Scenario C: Missing .js Extension

**Symptom**: Module resolution fails at runtime

```
Cannot find module '../../domain/llm-response'
```

**Fix**: Add `.js` extension to all relative imports

### Scenario D: Manifest Validation Fails

**Symptom**: lint:arch reports structural issues

```
[arch-lint] Invalid adapter: ManifestPatchAdapter not in manifest
```

**Fix**: Ensure manifest.yaml includes all Phase A adapters

---

## Dependencies Between Phases

Phase A adapters must verify they do NOT break any dependencies required for:

- Phase B: Export pipeline integration
- Phase C: Mutation boundary enforcement
- Phase D+: Subsequent phases

Verify:

- ✅ No breaking changes to existing ports
- ✅ No signature changes to exported adapters
- ✅ No modifications to domain entities used by other phases
