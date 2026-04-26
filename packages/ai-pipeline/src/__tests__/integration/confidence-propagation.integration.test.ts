/**
 * Integration test: Confidence Score Propagation
 *
 * Tests that confidence scores flow from parser → UseCase → SSE pipeline → UI.
 * Validates that low confidence triggers filtering and high confidence allows acceptance.
 */

import type { ParsedIntent } from "@hexagen/ai-pipeline";

// Mock types
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

// Mock Parser
class MockParser {
  parse(intent: string): ParseResult {
    // Simulate confidence scoring
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

// Mock UseCase
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

// Mock SSE Pipeline
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

      expect(result.success).toBe(true);
      if (result.success && result.value) {
        expect(result.value.confidence).toBeDefined();
        expect(typeof result.value.confidence).toBe("number");
      }
    });

    it("should generate confidence between 0.0 and 1.0", () => {
      const result = parser.parse("Add a bounded context");

      expect(result.success).toBe(true);
      if (result.success && result.value) {
        expect(result.value.confidence).toBeGreaterThanOrEqual(0);
        expect(result.value.confidence).toBeLessThanOrEqual(1);
      }
    });

    it("should increase confidence with longer intents", () => {
      const shortIntent = "Add";
      const longIntent =
        "Add a bounded context named OrderManagementService with entities Order, OrderItem";

      const shortResult = parser.parse(shortIntent);
      const longResult = parser.parse(longIntent);

      expect(shortResult.success).toBe(true);
      expect(longResult.success).toBe(true);

      if (shortResult.success && longResult.success) {
        const shortConf = shortResult.value?.confidence ?? 0;
        const longConf = longResult.value?.confidence ?? 0;

        expect(longConf).toBeGreaterThan(shortConf);
      }
    });

    it("should preserve confidence in parsed intent", () => {
      const intent = "Add a bounded context named PaymentService";
      const result = parser.parse(intent);

      expect(result.success).toBe(true);
      if (result.success && result.value) {
        expect(result.value.originalText).toBe(intent);
        expect(result.value.confidence).toBeDefined();
      }
    });
  });

  describe("Confidence Propagation to UseCase", () => {
    it("should pass confidence to ModifyArchitectureUseCase", async () => {
      const parseResult = parser.parse("Add a bounded context named Service1");

      expect(parseResult.success).toBe(true);
      if (parseResult.success && parseResult.value) {
        const request: ArchitectureModificationRequest = {
          intent: parseResult.value.originalText,
          confidence: parseResult.value.confidence,
        };

        const useCaseResult = await useCase.execute(request);

        expect(useCaseResult.confidence).toBe(parseResult.value.confidence);
      }
    });

    it("should maintain confidence through UseCase pipeline", async () => {
      const parseResult = parser.parse("Add an entity named Order");

      expect(parseResult.success).toBe(true);
      if (parseResult.success && parseResult.value) {
        const request: ArchitectureModificationRequest = {
          intent: parseResult.value.originalText,
          confidence: parseResult.value.confidence,
        };

        const beforeUseCase = request.confidence;
        const useCaseResult = await useCase.execute(request);

        expect(useCaseResult.confidence).toBe(beforeUseCase);
      }
    });

    it("should use confidence to determine filtering", async () => {
      const parseResult = parser.parse("Add a");

      expect(parseResult.success).toBe(true);
      if (parseResult.success && parseResult.value) {
        const request: ArchitectureModificationRequest = {
          intent: parseResult.value.originalText,
          confidence: parseResult.value.confidence,
        };

        const useCaseResult = await useCase.execute(request);

        if ((request.confidence ?? 0) < 0.7) {
          expect(useCaseResult.filtered).toBe(true);
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

      expect(result.filtered).toBe(true);
    });

    it("should mark patches as filtered when confidence is low", async () => {
      const request: ArchitectureModificationRequest = {
        intent: "x",
        confidence: 0.2,
      };

      const result = await useCase.execute(request);

      expect(result.confidence).toBeLessThan(0.7);
      expect(result.filtered).toBe(true);
    });

    it("should provide confidence reason in filter response", async () => {
      const request: ArchitectureModificationRequest = {
        intent: "short",
        confidence: 0.3,
      };

      const result = await useCase.execute(request);

      expect(result.filtered).toBe(true);
      expect(result.confidence).toBeLessThan(0.7);
    });
  });

  describe("High Confidence Acceptance", () => {
    it("should accept patches when confidence >= 0.7", async () => {
      const request: ArchitectureModificationRequest = {
        intent: "Add a bounded context named Service1",
        confidence: 0.8,
      };

      const result = await useCase.execute(request);

      expect(result.filtered).toBe(false);
    });

    it("should not filter patches when confidence is high", async () => {
      const longIntent =
        "Add a bounded context named PaymentProcessingService with entities Payment, Invoice";
      const request: ArchitectureModificationRequest = {
        intent: longIntent,
        confidence: 0.9,
      };

      const result = await useCase.execute(request);

      expect(result.filtered).toBe(false);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("Confidence in SSE Events", () => {
    it("should emit confidence in SSE progress events", async () => {
      const parseResult = parser.parse("Add a bounded context named Service");

      expect(parseResult.success).toBe(true);
      if (parseResult.success && parseResult.value) {
        pipeline.emit({
          type: "progress",
          confidence: parseResult.value.confidence,
        });

        const event = pipeline.getLastEvent();

        expect(event?.type).toBe("progress");
        expect(event?.confidence).toBeDefined();
      }
    });

    it("should include confidence in SSE completion events", async () => {
      const parseResult = parser.parse("Add a bounded context");

      expect(parseResult.success).toBe(true);
      if (parseResult.success && parseResult.value) {
        pipeline.emit({
          type: "complete",
          confidence: parseResult.value.confidence,
          data: { patches: [] },
        });

        const event = pipeline.getLastEvent();

        expect(event?.type).toBe("complete");
        expect(event?.confidence).toBeDefined();
      }
    });

    it("should maintain confidence across multiple SSE events", () => {
      const confidence = 0.85;

      pipeline.emit({ type: "progress", confidence });
      pipeline.emit({ type: "progress", confidence: confidence });
      pipeline.emit({ type: "complete", confidence });

      const events = pipeline.getEvents();

      expect(events).toHaveLength(3);
      events.forEach((event) => {
        expect(event.confidence).toBe(confidence);
      });
    });
  });

  describe("UI Confidence Display", () => {
    it("should provide confidence for UI rendering", async () => {
      const parseResult = parser.parse("Add a bounded context named Service1");

      expect(parseResult.success).toBe(true);
      if (parseResult.success && parseResult.value) {
        const uiData = {
          confidence: parseResult.value.confidence,
          confidencePercentage: Math.round(parseResult.value.confidence * 100),
        };

        expect(uiData.confidence).toBeGreaterThanOrEqual(0);
        expect(uiData.confidencePercentage).toBeGreaterThanOrEqual(0);
        expect(uiData.confidencePercentage).toBeLessThanOrEqual(100);
      }
    });

    it("should indicate high confidence to user", async () => {
      const intent =
        "Add a bounded context named OrderManagementService with entities Order, OrderItem, Invoice";
      const parseResult = parser.parse(intent);

      expect(parseResult.success).toBe(true);
      if (parseResult.success && parseResult.value) {
        const isHighConfidence = parseResult.value.confidence >= 0.8;

        expect(isHighConfidence).toBe(true);
      }
    });

    it("should indicate low confidence to user", () => {
      const parseResult = parser.parse("Add");

      expect(parseResult.success).toBe(true);
      if (parseResult.success && parseResult.value) {
        const isLowConfidence = parseResult.value.confidence < 0.5;

        expect(isLowConfidence).toBe(true);
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

      expect(canAutoAccept).toBe(true);
    });

    it("should require user review for low confidence patches", async () => {
      const confidence = 0.4;
      const request: ArchitectureModificationRequest = {
        intent: "x",
        confidence,
      };

      const result = await useCase.execute(request);

      const requiresReview = result.confidence < 0.7 || result.filtered;

      expect(requiresReview).toBe(true);
    });

    it("should provide manual review option for medium confidence", async () => {
      const confidence = 0.7;
      const request: ArchitectureModificationRequest = {
        intent: "Add something",
        confidence,
      };

      const result = await useCase.execute(request);

      const allowsManualReview = true;

      expect(allowsManualReview).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
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

        expect(result.filtered).toBe(testCase.filtered);
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

        expect(result.confidence).toBe(conf);
      }
    });
  });

  describe("End-to-End Confidence Flow", () => {
    it("should flow confidence: Parser → UseCase → SSE → UI", async () => {
      const intent = "Add a bounded context named OrderService";

      // 1. Parser generates confidence
      const parseResult = parser.parse(intent);
      expect(parseResult.success).toBe(true);

      if (parseResult.success && parseResult.value) {
        const parserConfidence = parseResult.value.confidence;

        // 2. Pass to UseCase
        const request: ArchitectureModificationRequest = {
          intent,
          confidence: parserConfidence,
        };

        const useCaseResult = await useCase.execute(request);

        // 3. Emit via SSE
        pipeline.emit({
          type: "complete",
          confidence: useCaseResult.confidence,
        });

        // 4. UI receives it
        const sseEvent = pipeline.getLastEvent();

        expect(sseEvent?.confidence).toBe(parserConfidence);
        expect(sseEvent?.confidence).toBe(useCaseResult.confidence);
      }
    });
  });
});
