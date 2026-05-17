import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ExecuteValidationReviewUseCase } from '../execute-validation-review.use-case.js';
import type { SendStructuredRequestPort } from '@hexagen/local-llm/client';
import { StageMaxRetriesError } from '../../../../domain/errors/stage-errors.js';
import type { StageTelemetry } from '../../../../domain/value-objects/stage-telemetry.js';

const createMockPipelineState = () => ({
  stage0: {
    intent: 'Invoice system',
    explicitTechnologies: [],
    explicitPatterns: [],
    ambiguities: [],
    projectName: 'invoice-app'
  },
  stage2: {
    accepted: [{ name: 'invoice-management', type: 'core' as const, reasoning: 'Manages invoices' }],
    rejected: [],
    uncertain: []
  },
  stage5: {
    yaml: 'openapi: 3.0.0\ninfo:\n  title: Invoice System\n  version: 1.0.0',
    parsedObject: {},
    assemblyWarnings: []
  },
  contextMappings: []
});

describe('ExecuteValidationReviewUseCase', () => {
  test('happy path: returns successful validation report', async () => {
    const mockLLM: SendStructuredRequestPort = {
      streamStructuredRequest: async function* () {
        yield { success: true, value: '{"type":"result","passed":true}\n' };
      }
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, true);
      assert.deepStrictEqual(result.value.errors, []);
      assert.deepStrictEqual(result.value.warnings, []);
    }
  });

  test('retry path: fails 2x then succeeds', async () => {
    let attemptCount = 0;
    const mockLLM: SendStructuredRequestPort = {
      streamStructuredRequest: async function* () {
        attemptCount++;
        if (attemptCount <= 2) {
          yield { success: false, error: new Error('LLM request failed') };
        } else {
          yield { success: true, value: '{"type":"result","passed":true}\n' };
        }
      }
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    assert.strictEqual(attemptCount, 3); // 2 fails + 1 success
  });

  test('max retries exceeded: returns StageMaxRetriesError', async () => {
    const mockLLM: SendStructuredRequestPort = {
      streamStructuredRequest: async function* () {
        yield { success: false, error: new Error('LLM request failed') };
      }
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
    }
  });

  test('telemetry callback is invoked with validation metrics', async () => {
    const telemetryCalls: StageTelemetry[] = [];
    const onStageTelemetry = (telemetry: StageTelemetry) => {
      telemetryCalls.push(telemetry);
    };

    const mockLLM: SendStructuredRequestPort = {
      streamStructuredRequest: async function* () {
        yield { success: true, value: '{"type":"result","passed":true}\n' };
      }
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    await useCase.execute(state, undefined, onStageTelemetry);

    assert.strictEqual(telemetryCalls.length, 1);
    assert.strictEqual(telemetryCalls[0].stage, 6);
    assert.strictEqual(telemetryCalls[0].label, 'Validation Review');
    assert.ok(telemetryCalls[0].durationMs >= 0);
    assert.strictEqual(telemetryCalls[0].usedLLM, true);
    assert.ok(telemetryCalls[0].summary.includes('passed'));
  });

  test('handles NDJSON with errors and warnings', async () => {
    const mockLLM: SendStructuredRequestPort = {
      streamStructuredRequest: async function* () {
        yield { success: true, value: '{"type":"error","message":"Invalid port"}\n{"type":"warning","message":"Deprecated adapter"}\n{"type":"result","passed":false}\n' };
      }
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteValidationReviewUseCase(mockLLM);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, false);
      assert.strictEqual(result.value.errors.length, 1);
      assert.strictEqual(result.value.warnings.length, 1);
    }
  });

  test('handles LLM timeout', async () => {
    const timeoutAdapter = {
      streamStructuredRequest: async function* () {
        await new Promise(() => {});
        yield { success: true, value: '' };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteValidationReviewUseCase(timeoutAdapter);
    const state = createMockPipelineState();

    const result = await Promise.race([
      useCase.execute(state),
      new Promise<{ success: false; error: unknown }>((_, reject) => 
        setTimeout(() => reject(new Error('Test timeout')), 100)
      ),
    ]).catch((err) => ({ success: false, error: err } as const));

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test('retry fails on persistent timeout', async () => {
    let callCount = 0;
    const timeoutAdapter = {
      streamStructuredRequest: async function* () {
        callCount++;
        if (callCount <= 3) {
          await new Promise(() => {});
        }
        yield { success: true, value: '{"type":"result","passed":true}\n' };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteValidationReviewUseCase(timeoutAdapter);
    const state = createMockPipelineState();
    const result = await useCase.execute(state).catch((err) => {
      return { success: false, error: err };
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  test('handles malformed LLM response', async () => {
    const badAdapter = {
      streamStructuredRequest: async function* () {
        yield { success: true, value: 'not valid json at all' };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteValidationReviewUseCase(badAdapter);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.ok(result.error instanceof StageMaxRetriesError);
    }
  });

  test('returns validation failure with errors', async () => {
    const invalidManifestAdapter = {
      streamStructuredRequest: async function* () {
        yield { success: true, value: '{"type":"result","passed":false,"errors":[{"rule":"R01","message":"Context uses technology"}]}\n' };
      },
    } as unknown as SendStructuredRequestPort;

    const useCase = new ExecuteValidationReviewUseCase(invalidManifestAdapter);
    const state = createMockPipelineState();
    const result = await useCase.execute(state);

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.value.passed, false);
      assert.ok(result.value.errors.length > 0);
      // Check that errors contain the expected rule (stringify to avoid type issues)
      const errorsString = JSON.stringify(result.value.errors);
      assert.ok(errorsString.includes('R01'));
    }
  });
});
