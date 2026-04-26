# Confidence Scoring Semantics

**Status:** Implemented (Phase B-10)  
**Last Updated:** 2026-04-26  
**Scope:** Natural Language Intent Parsing Pipeline

---

## 1. Overview

Confidence scoring is a quantitative measure of the AI pipeline's certainty about parsed natural language intents. Each parsed intent receives a confidence score between **0.0** (no confidence) and **1.0** (full confidence), indicating the reliability of the interpretation.

### Why Confidence Scoring Matters

- **Quality Indicators:** Scores reveal parsing ambiguity and pattern recognition confidence
- **Bias Detection:** Low-confidence clusters indicate problematic NL patterns that may bias future improvements
- **Explainability:** Confidence provides users with transparency about command reliability before execution
- **Audit Trails:** Recorded with each command execution for compliance and debugging
- **Adaptive Filtering:** Enables confidence-based acceptance workflows (see Phase E proposal)

---

## 2. Score Semantics

Confidence scores use a **uniform 0.0-1.0 range** divided into three behavioral zones:

| Range         | Label      | Characteristics                                                                        | User Action                                     |
| ------------- | ---------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **0.0–0.33**  | **Low**    | Pattern not recognized, ambiguous intent, typos detected, unknown command structure    | Requires explicit confirmation before execution |
| **0.34–0.66** | **Medium** | Pattern partially matched, some edge cases, missing parameters extracted with defaults | Shows warning badge; user accepts explicitly    |
| **0.67–1.0**  | **High**   | Clear intent, matches known patterns exactly, all parameters present, unambiguous      | Auto-executes with audit trail (Phase E)        |

### Semantic Boundaries

- **0.0:** Command rejected entirely (parser error or empty input)
- **0.33 → 0.34:** Transition from "unsafe to use without confirmation" to "acceptable with review"
- **0.66 → 0.67:** Transition from "warn user" to "high confidence zone"
- **1.0:** Perfect match; all signals positive (rare in practice)

---

## 3. Current Implementation

### Score Calculation: `NLToDomainCommandAdapter`

Located: [`packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts`](../packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts)

#### Scoring Strategy

The adapter uses **intent-type-based confidence lookup** with predefined scores:

```typescript
const INTENT_CONFIDENCE: Record<string, number> = {
  create_bounded_context: 0.95, // Highest: clear pattern
  create_port: 0.9, // Very high: specific pattern
  rename_context: 0.85, // High: unambiguous intent
  create_entity: 0.9, // Very high: specific syntax
  create_use_case: 0.9, // Very high: specific syntax
  create_edge: 0.9, // Very high: directional clear
  update_context: 0.8, // High: but flexible property field
};
```

#### Pattern Matching Process

1. **Regex Pattern Matching:** Intent string matched against predefined regex patterns
2. **Intent Type Detection:** First matching pattern determines intent type
3. **Confidence Lookup:** Intent type looked up in `INTENT_CONFIDENCE` table
4. **Default Fallback:** If not found, default confidence is 0.8

**Example:**

```
Input:  "Add a bounded context named OrderService"
Match:  Pattern 1 (create_bounded_context)
Score:  INTENT_CONFIDENCE["create_bounded_context"] = 0.95
```

#### Current Scoring Logic

- **No fuzzy matching:** Score does not degrade based on typos or case variations
- **Pattern-based:** All successful matches of same intent type receive identical confidence
- **No parameter extraction feedback:** Missing or malformed parameters don't reduce score (Phase E enhancement)
- **No synonym matching:** Exact regex patterns required (strict matching)

### Score Propagation Pipeline

```
NLToDomainCommandAdapter.parseWithMetadata()
         ↓
    Creates ParsedIntent with confidence
         ↓
ParseNLIntentUseCase.execute()
         ↓
    Returns ParsedIntent value object
         ↓
ModifyArchitectureUseCase (TBD: Phase D/E)
         ↓
    SSE Event Pipeline
         ↓
    UI Receives confidence in response
```

**Key File References:**

- Parser Port: [`packages/ai-pipeline/src/application/ports/in/nl-parser.port.ts`](../packages/ai-pipeline/src/application/ports/in/nl-parser.port.ts)
- ParseNLIntentUseCase: [`packages/ai-pipeline/src/application/use-cases/parse-nl-intent.use-case.ts:38-85`](../packages/ai-pipeline/src/application/use-cases/parse-nl-intent.use-case.ts)
- ParsedIntent Value Object: [`packages/ai-pipeline/src/domain/parsed-intent.ts`](../packages/ai-pipeline/src/domain/parsed-intent.ts)

---

## 4. Score Sources by Adapter

### 4.1 NL Parser (Primary Source)

**Adapter:** `NLToDomainCommandParserAdapter`

**Input Signals:**

- Regex pattern matching success
- Intent type clarity (how specific the matched pattern)
- Parameter extraction completeness
- Case normalization (case-insensitive patterns → slight bonus)

**Scoring Logic:**

```
confidence = INTENT_CONFIDENCE[detected_intent_type] ?? 0.8
```

**Possible Scores:** 0.0 (pattern not recognized), 0.8 (default), 0.85–0.95 (intent-specific)

**Example Calculations:**

| Intent                                | Pattern Match | Intent Type              | Confidence | Rationale                           |
| ------------------------------------- | ------------- | ------------------------ | ---------- | ----------------------------------- |
| `"Add a bounded context named Order"` | ✓             | `create_bounded_context` | 0.95       | Clear pattern, all params present   |
| `"Add a port to Order named API"`     | ✓             | `create_port`            | 0.9        | Specific intent, port type inferred |
| `"Rename user to account"`            | ✓             | `rename_context`         | 0.85       | Unambiguous, two params required    |
| `"create link from A to B"`           | ✓             | `create_edge`            | 0.9        | Directional intent clear            |
| `"Add something"`                     | ✗             | N/A                      | 0.0        | No pattern matched, error returned  |

### 4.2 Prompt Compiler (Future: Phase D)

**Scope:** Not implemented in Phase B-10; designed for Phase D LLM-based parsing.

**Input Signals:**

- Template matching completeness
- Prompt schema validation success
- Missing optional fields

**Proposed Scoring:**

```
confidence = base_confidence × template_match_ratio × schema_validation_ratio
```

### 4.3 LLM Adapter (Future: Phase D)

**Scope:** Not implemented in Phase B-10; designed for fallback LLM-based intent resolution.

**Input Signals:**

- Response schema validation
- Provider reliability (model-specific confidence adjustment)
- Token probability scores (if available from LLM)

**Proposed Scoring:**

```
confidence = llm_probability × provider_reliability_factor
```

### 4.4 Reconciliation Engine (Future: Phase E)

**Scope:** Not implemented; designed for multi-adapter consensus scoring.

**Input Signals:**

- Patch target validity
- Conflict resolution success
- Domain constraint satisfaction

**Proposed Scoring:**

```
confidence = min(parser_confidence, patch_validity_score)
```

---

## 5. Filtering Thresholds (Proposed for Phase E)

This section defines the acceptance workflow for Phase E implementation.

### 5.1 Filtering Strategy

```typescript
/**
 * Pseudocode: Confidence-based filtering in ModifyArchitectureUseCase
 */

async function filterAndExecuteCommand(
  parsedIntent: ParsedIntent,
  userContext: UserContext,
): Promise<CommandExecutionResult> {
  const { confidence, commands } = parsedIntent;

  if (confidence < 0.4) {
    // REJECT: Low confidence
    return {
      status: "REJECTED",
      reason: "Low confidence command not executed without user confirmation",
      confidence,
      suggestUserConfirmation: true,
      requiredAction: "EXPLICIT_ACCEPT",
    };
  }

  if (confidence >= 0.4 && confidence < 0.7) {
    // WARN: Medium confidence
    return {
      status: "PENDING_REVIEW",
      reason: "Medium confidence requires explicit user acceptance",
      confidence,
      warningBadge: true,
      requiredAction: "EXPLICIT_ACCEPT",
    };
  }

  if (confidence >= 0.7) {
    // ACCEPT: High confidence
    const result = await executeCommands(commands);
    return {
      status: "EXECUTED",
      confidence,
      auditTrail: {
        timestamp: new Date(),
        confidence,
        originalIntent: parsedIntent.originalText,
        autoAccepted: confidence >= 0.9,
      },
      requiredAction: "NONE",
    };
  }
}
```

### 5.2 Threshold Definitions

| Threshold   | Confidence Range | Behavior                                                     | User Feedback                                        | Auto-Execute |
| ----------- | ---------------- | ------------------------------------------------------------ | ---------------------------------------------------- | ------------ |
| **Reject**  | < 0.4            | Command blocked; requires explicit confirmation in UI dialog | "Low confidence (40%). Please review and confirm."   | ✗ Never      |
| **Warn**    | 0.4–0.7          | Command held for review; warning badge displayed             | "Medium confidence (60%). Please accept to proceed." | ✗ Never      |
| **Accept**  | ≥ 0.7            | Command executed automatically; audit trail recorded         | "High confidence (85%). Executed automatically."     | ✓ Always     |
| **Premium** | ≥ 0.9            | Optional: Skip review entirely, execute silently             | "Very high confidence (95%). Auto-executed."         | ✓ Immediate  |

### 5.3 User Confirmation Flow (Phase E)

**Low Confidence (<0.4):**

```
1. User submits NL intent
2. Parser returns confidence < 0.4
3. UI shows dialog: "This command has low confidence. Confirm to proceed?"
4. User clicks "Confirm" → Command executes (with confidence recorded)
5. User clicks "Reject" → Command discarded
```

**Medium Confidence (0.4–0.7):**

```
1. User submits NL intent
2. Parser returns confidence 0.4–0.7
3. UI shows warning badge on preview
4. Preview shows: "Medium confidence (55%). Parsed as: [COMMAND]"
5. User clicks "Accept" → Command executes
6. User clicks "Revise" → Return to input for re-entry
```

**High Confidence (≥0.7):**

```
1. User submits NL intent
2. Parser returns confidence ≥ 0.7
3. Command executes automatically
4. Toast notification: "Command executed (confidence: 85%)"
5. Audit trail includes confidence level
```

---

## 6. Use Cases for Confidence Scores

### 6.1 User Feedback Collection

**Low-Confidence Feedback Loop:**

```typescript
if (confidence < 0.5) {
  // After execution, prompt user:
  // "Was this command correct? [👍 Yes] [👎 No]"

  userFeedback.collect({
    originalIntent,
    parsedCommand,
    confidence,
    userRating: "yes" | "no",
  });
}
```

**Rationale:** Low-confidence commands are ideal for training data; user feedback directly improves model accuracy.

### 6.2 Audit Trail Recording

Every command execution records:

```typescript
auditEntry = {
  timestamp: ISO8601,
  originalIntent: string,
  parsedCommands: DomainCommand[],
  confidence: number,
  intentType: string,
  autoAccepted: boolean,
  userConfirmed: boolean,
  executionResult: "success" | "failed",
};
```

**Rationale:** Confidence enables forensic analysis of erroneous commands and decision justification.

### 6.3 Model Training Pipeline

**Confidence Distribution Analysis:**

```typescript
// Aggregate low-confidence patterns
const lowConfidencePatterns = auditLog
  .filter(
    (entry) => entry.confidence < 0.5 && entry.executionResult === "failed",
  )
  .groupBy("intentType");

// Identify problematic patterns for retraining
retrainingPipeline.addPatterns(lowConfidencePatterns);
```

**Rationale:** Systematic improvement of NL adapter based on real-world failure modes.

### 6.4 Rollback Hints

**For Low-Confidence Patches:**

```typescript
if (confidence < 0.5) {
  UI.showRollbackHint({
    message:
      "This command had low confidence. Consider rolling back if unexpected behavior occurs.",
    confidenceLevel: confidence,
    affectedNodes: commands.map((c) => c.targetNodeId),
    rollbackButton: true,
  });
}
```

**Rationale:** User can preemptively understand risk and take protective action.

---

## 7. Testing Strategy

### 7.1 Unit Tests: Adapter Returns Correct Scores

**File:** `packages/ai-pipeline/src/__tests__/use-cases/parse-nl-intent.use-case.test.ts`

```typescript
describe("NLToDomainCommandParserAdapter - Confidence Scoring", () => {
  let adapter: NLToDomainCommandParserAdapter;

  beforeEach(() => {
    adapter = new NLToDomainCommandParserAdapter();
  });

  describe("Low Confidence (0.0–0.33)", () => {
    it("should return 0.0 for unsupported intent", async () => {
      const result = await adapter.parseWithMetadata("xyz");
      expect(result.success).toBe(false); // Parser error
    });

    it("should return 0.0 for empty input", async () => {
      const result = await adapter.parseWithMetadata("");
      expect(result.success).toBe(false);
    });
  });

  describe("High Confidence (0.67–1.0)", () => {
    it("should return 0.95 for create_bounded_context", async () => {
      const result = await adapter.parseWithMetadata(
        "Add a bounded context named OrderService",
      );
      expect(result.success).toBe(true);
      expect(result.value?.metadata.confidence).toBe(0.95);
    });

    it("should return 0.9 for create_port", async () => {
      const result = await adapter.parseWithMetadata(
        "Add a port to OrderService named API",
      );
      expect(result.success).toBe(true);
      expect(result.value?.metadata.confidence).toBe(0.9);
    });

    it("should return 0.85 for rename_context", async () => {
      const result = await adapter.parseWithMetadata(
        "Rename OrderService to OrderManagement",
      );
      expect(result.success).toBe(true);
      expect(result.value?.metadata.confidence).toBe(0.85);
    });

    it("should return 0.9 for create_entity", async () => {
      const result = await adapter.parseWithMetadata(
        "Add an entity named Order to OrderService",
      );
      expect(result.success).toBe(true);
      expect(result.value?.metadata.confidence).toBe(0.9);
    });
  });

  describe("Boundary Testing", () => {
    it("should enforce confidence between 0.0 and 1.0", async () => {
      const parsedIntent = createParsedIntent(
        "test",
        [],
        -0.1, // Invalid
        "test",
        {},
      );
      // Should throw
      expect(() => parsedIntent).toThrow("Confidence must be between 0 and 1");
    });

    it("should accept 0.0", async () => {
      const result = createParsedIntent("test", [], 0.0, "test", {});
      expect(result.confidence).toBe(0.0);
    });

    it("should accept 1.0", async () => {
      const result = createParsedIntent("test", [], 1.0, "test", {});
      expect(result.confidence).toBe(1.0);
    });
  });
});
```

### 7.2 Integration Tests: Confidence Propagates End-to-End

**File:** `packages/ai-pipeline/src/__tests__/integration/confidence-propagation.integration.test.ts`

Already implemented; see integration test file for full test coverage.

```typescript
it("should flow confidence: Parser → UseCase → SSE → UI", async () => {
  const intent = "Add a bounded context named OrderService";

  // 1. Parser generates confidence
  const parseResult = parser.parse(intent);
  expect(parseResult.value?.confidence).toBe(0.95);

  // 2. Pass to UseCase
  const request = {
    intent,
    confidence: parseResult.value?.confidence,
  };
  const useCaseResult = await useCase.execute(request);
  expect(useCaseResult.confidence).toBe(0.95);

  // 3. Emit via SSE
  pipeline.emit({ type: "complete", confidence: 0.95 });

  // 4. UI receives it
  const sseEvent = pipeline.getLastEvent();
  expect(sseEvent?.confidence).toBe(0.95);
});
```

### 7.3 E2E Tests: UI Displays Confidence Badges

**Scope:** Future (Phase E)

```typescript
it("should display high confidence badge for 0.9 score", async () => {
  const page = await browser.goto("http://localhost:3000/assistant");
  await page.type(
    '[data-testid="nl-input"]',
    "Add a bounded context named Service",
  );
  await page.click('[data-testid="submit-btn"]');

  const badge = await page.$('[data-testid="confidence-badge"]');
  const text = await badge?.textContent();

  expect(text).toContain("90%");
  expect(text).toContain("High Confidence");
});

it("should show warning badge for 0.55 score", async () => {
  const page = await browser.goto("http://localhost:3000/assistant");
  // ... submit ambiguous command

  const badge = await page.$('[data-testid="confidence-badge"]');
  const classList = await badge?.getAttribute("class");

  expect(classList).toContain("warning");
});
```

---

## 8. Future Enhancements

### 8.1 Adaptive Thresholds (Phase F)

**Concept:** Learn filtering thresholds from user accept/reject patterns.

```typescript
/**
 * Observe user behavior over time:
 * - If user always rejects commands at 0.65 confidence → Lower threshold to 0.6
 * - If user frequently confirms low-confidence (0.3) commands → Raise threshold to 0.4
 */

class AdaptiveThresholdLearner {
  private acceptanceRate: Map<number, number> = new Map();

  recordUserAction(confidence: number, action: "accept" | "reject"): void {
    const bucket = Math.round(confidence * 10) / 10; // 0.0–1.0 in 0.1 steps
    // Update acceptance rate for bucket
  }

  getAdaptiveThreshold(): number {
    // Return threshold where user acceptance probability drops below 50%
    return this.findThreshold(0.5);
  }
}
```

**Benefits:**

- Personalized user experience (power users may raise thresholds)
- Automatic calibration to domain complexity
- Reduced false positives/negatives

### 8.2 Confidence Variance Tracking

**Concept:** Track confidence distribution over time to detect model drift.

```typescript
class ConfidenceVarianceTracker {
  private window: number[] = []; // Rolling window of last N scores
  private readonly WINDOW_SIZE = 100;

  addScore(confidence: number): void {
    this.window.push(confidence);
    if (this.window.length > this.WINDOW_SIZE) {
      this.window.shift();
    }
  }

  getVariance(): number {
    const mean = this.window.reduce((a, b) => a + b, 0) / this.window.length;
    const variance =
      this.window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
      this.window.length;
    return variance;
  }

  detectDrift(): boolean {
    // If variance spikes, model confidence is becoming unpredictable
    return this.getVariance() > DRIFT_THRESHOLD;
  }
}
```

**Benefits:**

- Early detection of model degradation
- Automatic retraining triggers
- System health monitoring

### 8.3 Multi-Factor Confidence (Phase E)

**Concept:** Combine scores from multiple adapters.

```typescript
/**
 * Ensemble scoring: confidence = min of all adapter scores
 * (conservative: only as confident as the least confident adapter)
 */

async function multiFactorConfidence(intent: string): Promise<number> {
  const nlScore = await nlParser.parseWithMetadata(intent);
  const promptScore = await promptCompiler.compile(intent);
  const llmScore = await llmAdapter.generate(intent);

  if (!nlScore.success || !promptScore.success || !llmScore.success) {
    return 0.0; // Any adapter failure → low confidence
  }

  return Math.min(
    nlScore.value.metadata.confidence,
    promptScore.value.confidence,
    llmScore.value.confidence,
  );
}
```

**Scoring Formula:**

```
confidence = parser_confidence × prompt_confidence × llm_confidence
```

(Multiplicative: all must be confident for high overall confidence)

**Benefits:**

- Reduces false positives by requiring consensus
- Identifies disagreement between adapters (flag for human review)
- Scales naturally to >3 adapters

---

## 9. Implementation Checklist

### Phase B-10 (✓ Complete)

- [x] Define confidence range (0.0–1.0)
- [x] Implement `NLToDomainCommandParserAdapter` with intent-based scoring
- [x] Create `ParsedIntent` value object with confidence field
- [x] Integrate confidence into `ParseNLIntentUseCase`
- [x] Create integration test for confidence propagation
- [x] Document semantics (this file)

### Phase D (⏳ Planned)

- [ ] Implement `PromptCompilerAdapter` with template-based scoring
- [ ] Implement `LLMAdapter` with LLM response scoring
- [ ] Add multi-factor confidence calculation
- [ ] Extend integration tests to cover all adapters

### Phase E (⏳ Planned)

- [ ] Implement confidence-based filtering in `ModifyArchitectureUseCase`
- [ ] Add warning badges to UI for 0.4–0.7 range
- [ ] Add confirmation dialogs for <0.4 range
- [ ] Implement audit trail recording
- [ ] Create E2E tests for UI confidence display

### Phase F (⏳ Planned)

- [ ] Implement adaptive threshold learning
- [ ] Add confidence variance tracking and drift detection
- [ ] Create confidence variance dashboard
- [ ] Implement multi-adapter ensemble scoring

---

## 10. References

- **Parser Port:** `packages/ai-pipeline/src/application/ports/in/nl-parser.port.ts`
- **Adapter Implementation:** `packages/ai-pipeline/src/infrastructure/adapters/nl-to-domain-command.adapter.ts`
- **Use Case:** `packages/ai-pipeline/src/application/use-cases/parse-nl-intent.use-case.ts`
- **Domain Model:** `packages/ai-pipeline/src/domain/parsed-intent.ts`
- **Integration Tests:** `packages/ai-pipeline/src/__tests__/integration/confidence-propagation.integration.test.ts`
- **Architecture Decision Record:** `.architecture/decisions/` (TBD: ADR for confidence scoring strategy)

---

## 11. Glossary

- **Confidence Score:** Numeric value (0.0–1.0) representing parser certainty about intent interpretation
- **Intent Type:** Categorization of user's natural language request (e.g., `create_bounded_context`, `rename_context`)
- **Pattern Matching:** Regex-based recognition of known NL command structures
- **Threshold:** Confidence boundary triggering decision logic (e.g., 0.7 for auto-accept)
- **Audit Trail:** Historical record of command execution with confidence and user actions
- **Consensus Score:** Multi-adapter confidence combining parser, compiler, and LLM scores
- **Drift Detection:** Monitoring confidence distribution to identify model reliability degradation

---

**Document Version:** 1.0  
**Last Reviewed:** 2026-04-26  
**Next Review:** After Phase D implementation (confidence expansion to LLM adapter)
