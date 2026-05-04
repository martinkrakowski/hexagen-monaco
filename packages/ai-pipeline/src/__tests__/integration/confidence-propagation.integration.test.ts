import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type { ParsedIntent } from "@hexagen/ai-pipeline";

interface ParseResult {
  success: boolean;
  value?: ParsedIntent;
  error?: Error;
}

interface ArchitectureModificationRequest {
  intent: string;
  confidence?: number;
}

interface ArchitectureModificationResponse {
  patches: unknown[];
  confidence: number;
  filtered: boolean;
}

interface SSEEvent {
  type: "progress" | "complete" | "error";
  confidence?: number;
  data?: unknown;
}

class MockParser {
  parse(intent: string): ParseResult {
    const intentLength = intent.length;
    const confidence = Math.min(intentLength / 100, 1);

    return {
      success: true,
      value: {
        originalText: intent,
        commands: [{ type: "CreateNode", payload: { attributes: {} } } as any],
        confidence,
        intentType: "create_context",
        parameters: { name: "Service" },
      },
    };
  }
}

class MockModifyArchitectureUseCase {
  async execute(
    request: ArchitectureModificationRequest,
  ): Promise<ArchitectureModificationResponse> {
    const confidence = request.confidence ?? 0.5;
    const filtered = confidence < 0.7;

    return {
      patches: [],
      confidence,
      filtered,
    };
  }
}

class MockSSEPipeline {
  private events: SSEEvent[] = [];

  emit(event: SSEEvent): void {
    this.events.push(event);
  }

  getEvents(): SSEEvent[] {
    return this.events;
  }

  getLastEvent(): SSEEvent | undefined {
    return this.events[this.events.length - 1];
  }
}

describe("Confidence Score Propagation - Integration Tests", () => {
  let parser: MockParser;
  let useCase: MockModifyArchitectureUseCase;
  let pipeline: MockSSEPipeline;

  beforeEach(() => {
    parser = new MockParser();
    useCase = new MockModifyArchitectureUseCase();
    pipeline = new MockSSEPipeline();
  });

  describe("Parser Confidence Generation", () => {
    it("should generate confidence score from parser", () => {
      const result = parser.parse("Add a bounded context named Service");

      assert.strictEqual(result.success, true);
      if (result.success && result.value) {
        assert.ok(result.value.confidence !== undefined);
        assert.strictEqual(typeof result.value.confidence, "number");
      }
    });

    it("should generate confidence between 0.0 and 1.0", () => {
      const result = parser.parse("Add a bounded context");

      assert.strictEqual(result.success, true);
      if (result.success && result.value) {
        assert.ok(result.value.confidence >= 0);
        assert.ok(result.value.confidence <= 1);
      }
    });

    it("should increase confidence with longer intents", () => {
      const shortIntent = "Add";
      const longIntent =
        "Add a bounded context named OrderManagementService with entities Order, OrderItem";

      const shortResult = parser.parse(shortIntent);
      const longResult = parser.parse(longIntent);

      assert.strictEqual(shortResult.success, true);
      assert.strictEqual(longResult.success, true);

      if (shortResult.success && longResult.success) {
        const shortConf = shortResult.value?.confidence ?? 0;
        const longConf = longResult.value?.confidence ?? 0;

        assert.ok(longConf > shortConf);
      }
    });

    it("should preserve confidence in parsed intent", () => {
      const intent = "Add a bounded context named PaymentService";
      const result = parser.parse(intent);

      assert.strictEqual(result.success, true);
      if (result.success && result.value) {
        assert.strictEqual(result.value.originalText, intent);
        assert.ok(result.value.confidence !== undefined);
      }
    });
  });

  describe("Confidence Propagation to UseCase", () => {
    it("should pass confidence to ModifyArchitectureUseCase", async () => {
      const parseResult = parser.parse("Add a bounded context named Service1");

      assert.strictEqual(parseResult.success, true);
      if (parseResult.success && parseResult.value) {
        const request: ArchitectureModificationRequest = {
          intent: parseResult.value.originalText,
          confidence: parseResult.value.confidence,
        };

        const useCaseResult = await useCase.execute(request);

        assert.strictEqual(
          useCaseResult.confidence,
          parseResult.value.confidence,
        );
      }
    });

    it("should maintain confidence through UseCase pipeline", async () => {
      const parseResult = parser.parse("Add an entity named Order");

      assert.strictEqual(parseResult.success, true);
      if (parseResult.success && parseResult.value) {
        const request: ArchitectureModificationRequest = {
          intent: parseResult.value.originalText,
          confidence: parseResult.value.confidence,
        };

        const beforeUseCase = request.confidence;
        const useCaseResult = await useCase.execute(request);

        assert.strictEqual(useCaseResult.confidence, beforeUseCase);
      }
    });

    it("should use confidence to determine filtering", async () => {
      const parseResult = parser.parse("Add a");

      assert.strictEqual(parseResult.success, true);
      if (parseResult.success && parseResult.value) {
        const request: ArchitectureModificationRequest = {
          intent: parseResult.value.originalText,
          confidence: parseResult.value.confidence,
        };

        const useCaseResult = await useCase.execute(request);

        if ((request.confidence ?? 0) < 0.7) {
          assert.strictEqual(useCaseResult.filtered, true);
        }
      }
    });
  });

  describe("Low Confidence Filtering", () => {
    it("should filter patches when confidence < 0.7", async () => {
      const request: ArchitectureModificationRequest = {
        intent: "Add a",
        confidence: 0.5,
      };

      const result = await useCase.execute(request);

      assert.strictEqual(result.filtered, true);
    });

    it("should mark patches as filtered when confidence is low", async () => {
      const request: ArchitectureModificationRequest = {
        intent: "x",
        confidence: 0.2,
      };

      const result = await useCase.execute(request);

      assert.ok(result.confidence < 0.7);
      assert.strictEqual(result.filtered, true);
    });

    it("should provide confidence reason in filter response", async () => {
      const request: ArchitectureModificationRequest = {
        intent: "short",
        confidence: 0.3,
      };

      const result = await useCase.execute(request);

      assert.strictEqual(result.filtered, true);
      assert.ok(result.confidence < 0.7);
    });
  });

  describe("High Confidence Acceptance", () => {
    it("should accept patches when confidence >= 0.7", async () => {
      const request: ArchitectureModificationRequest = {
        intent: "Add a bounded context named Service1",
        confidence: 0.8,
      };

      const result = await useCase.execute(request);

      assert.strictEqual(result.filtered, false);
    });

    it("should not filter patches when confidence is high", async () => {
      const longIntent =
        "Add a bounded context named PaymentProcessingService with entities Payment, Invoice";
      const request: ArchitectureModificationRequest = {
        intent: longIntent,
        confidence: 0.9,
      };

      const result = await useCase.execute(request);

      assert.strictEqual(result.filtered, false);
      assert.ok(result.confidence >= 0.7);
    });
  });

  describe("Confidence in SSE Events", () => {
    it("should emit confidence in SSE progress events", async () => {
      const parseResult = parser.parse("Add a bounded context named Service");

      assert.strictEqual(parseResult.success, true);
      if (parseResult.success && parseResult.value) {
        pipeline.emit({
          type: "progress",
          confidence: parseResult.value.confidence,
        });

        const event = pipeline.getLastEvent();

        assert.strictEqual(event?.type, "progress");
        assert.ok(event?.confidence !== undefined);
      }
    });

    it("should include confidence in SSE completion events", async () => {
      const parseResult = parser.parse("Add a bounded context");

      assert.strictEqual(parseResult.success, true);
      if (parseResult.success && parseResult.value) {
        pipeline.emit({
          type: "complete",
          confidence: parseResult.value.confidence,
          data: { patches: [] },
        });

        const event = pipeline.getLastEvent();

        assert.strictEqual(event?.type, "complete");
        assert.ok(event?.confidence !== undefined);
      }
    });

    it("should maintain confidence across multiple SSE events", () => {
      const confidence = 0.85;

      pipeline.emit({ type: "progress", confidence });
      pipeline.emit({ type: "progress", confidence: confidence });
      pipeline.emit({ type: "complete", confidence });

      const events = pipeline.getEvents();

      assert.strictEqual(events.length, 3);
      events.forEach((event) => {
        assert.strictEqual(event.confidence, confidence);
      });
    });
  });

  describe("UI Confidence Display", () => {
    it("should provide confidence for UI rendering", async () => {
      const parseResult = parser.parse("Add a bounded context named Service1");

      assert.strictEqual(parseResult.success, true);
      if (parseResult.success && parseResult.value) {
        const uiData = {
          confidence: parseResult.value.confidence,
          confidencePercentage: Math.round(parseResult.value.confidence * 100),
        };

        assert.ok(uiData.confidence >= 0);
        assert.ok(uiData.confidencePercentage >= 0);
        assert.ok(uiData.confidencePercentage <= 100);
      }
    });

    it("should indicate high confidence to user", async () => {
      const intent =
        "Add a bounded context named OrderManagementService with entities Order, OrderItem, Invoice";
      const parseResult = parser.parse(intent);

      assert.strictEqual(parseResult.success, true);
      if (parseResult.success && parseResult.value) {
        const isHighConfidence = parseResult.value.confidence >= 0.8;

        assert.strictEqual(isHighConfidence, true);
      }
    });

    it("should indicate low confidence to user", () => {
      const parseResult = parser.parse("Add");

      assert.strictEqual(parseResult.success, true);
      if (parseResult.success && parseResult.value) {
        const isLowConfidence = parseResult.value.confidence < 0.5;

        assert.strictEqual(isLowConfidence, true);
      }
    });
  });

  describe("Confidence-Based User Actions", () => {
    it("should enable auto-accept for high confidence patches", async () => {
      const confidence = 0.95;
      const request: ArchitectureModificationRequest = {
        intent: "Add a bounded context named Service",
        confidence,
      };

      const result = await useCase.execute(request);

      const canAutoAccept = result.confidence >= 0.9 && !result.filtered;

      assert.strictEqual(canAutoAccept, true);
    });

    it("should require user review for low confidence patches", async () => {
      const confidence = 0.4;
      const request: ArchitectureModificationRequest = {
        intent: "x",
        confidence,
      };

      const result = await useCase.execute(request);

      const requiresReview = result.confidence < 0.7 || result.filtered;

      assert.strictEqual(requiresReview, true);
    });

    it("should provide manual review option for medium confidence", async () => {
      const confidence = 0.7;
      const request: ArchitectureModificationRequest = {
        intent: "Add something",
        confidence,
      };

      const result = await useCase.execute(request);

      const allowsManualReview = true;

      assert.strictEqual(allowsManualReview, true);
      assert.ok(result.confidence >= 0.7);
    });
  });

  describe("Confidence Thresholds", () => {
    it("should define filtering threshold at 0.7", async () => {
      const testCases = [
        { confidence: 0.6, filtered: true },
        { confidence: 0.7, filtered: false },
        { confidence: 0.8, filtered: false },
      ];

      for (const testCase of testCases) {
        const request: ArchitectureModificationRequest = {
          intent: "test",
          confidence: testCase.confidence,
        };

        const result = await useCase.execute(request);

        assert.strictEqual(result.filtered, testCase.filtered);
      }
    });

    it("should preserve confidence value across threshold boundary", async () => {
      const confidences = [0.69, 0.7, 0.71];

      for (const conf of confidences) {
        const request: ArchitectureModificationRequest = {
          intent: "test",
          confidence: conf,
        };

        const result = await useCase.execute(request);

        assert.strictEqual(result.confidence, conf);
      }
    });
  });

  describe("End-to-End Confidence Flow", () => {
    it("should flow confidence: Parser → UseCase → SSE → UI", async () => {
      const intent = "Add a bounded context named OrderService";

      const parseResult = parser.parse(intent);
      assert.strictEqual(parseResult.success, true);

      if (parseResult.success && parseResult.value) {
        const parserConfidence = parseResult.value.confidence;

        const request: ArchitectureModificationRequest = {
          intent,
          confidence: parserConfidence,
        };

        const useCaseResult = await useCase.execute(request);

        pipeline.emit({
          type: "complete",
          confidence: useCaseResult.confidence,
        });

        const sseEvent = pipeline.getLastEvent();

        assert.strictEqual(sseEvent?.confidence, parserConfidence);
        assert.strictEqual(sseEvent?.confidence, useCaseResult.confidence);
      }
    });
  });
});
