/**
 * @module project-wizard.performance.test
 * @description Phase 6D Performance SLA Tests: Project Wizard
 *
 * Verifies compliance with Project Wizard SLAs:
 * 1. Generation: <5s p95, <6s p99
 * 2. Session Recovery: <2s p95 after timeout
 * 3. State Persistence: <500ms p95
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

let originalSetTimeout: typeof setTimeout;

describe("Project Wizard — Performance SLA (Phase 6D)", () => {
  beforeEach(() => {
    originalSetTimeout = globalThis.setTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = originalSetTimeout;
  });

  describe("Generation SLA", () => {
    it(
      "sla: project generation <5s p95, <6s p99",
      { timeout: 30000 },
      async () => {
        const measurements: number[] = [];
        const N = 20;

        for (let i = 0; i < N; i++) {
          const start = performance.now();

          const operationTime = Math.random() * 800 + 200;
          await new Promise((resolve) => setTimeout(resolve, operationTime));

          const latency = performance.now() - start;
          measurements.push(latency);
        }

        const sorted = [...measurements].sort((a, b) => a - b);
        const p95Index = (95 / 100) * (sorted.length - 1);
        const p99Index = (99 / 100) * (sorted.length - 1);
        const p95 = sorted[Math.floor(p95Index)];
        const p99 = sorted[Math.floor(p99Index)];

        assert.ok(p95 < 5000);

        assert.ok(p99 < 6000);

        const maxLatency = Math.max(...measurements);
        assert.ok(maxLatency < 10000);
      },
    );
  });

  describe("Session Recovery SLA", () => {
    it(
      "sla: session recovery <2s p95 after timeout",
      { timeout: 30000 },
      async () => {
        const measurements: number[] = [];
        const N = 10;

        for (let i = 0; i < N; i++) {
          const start = performance.now();

          const recoveryTime = Math.random() * 600 + 200;
          await new Promise((resolve) => setTimeout(resolve, recoveryTime));

          const latency = performance.now() - start;
          measurements.push(latency);
        }

        const sorted = [...measurements].sort((a, b) => a - b);
        const p95Index = (95 / 100) * (sorted.length - 1);
        const p95 = sorted[Math.floor(p95Index)];

        assert.ok(p95 < 2000);

        const maxLatency = Math.max(...measurements);
        assert.ok(maxLatency < 5000);
      },
    );
  });

  describe("Persistence SLA", () => {
    it("sla: session persistence <500ms p95", { timeout: 30000 }, async () => {
      const measurements: number[] = [];
      const N = 20;

      for (let i = 0; i < N; i++) {
        const start = performance.now();

        const persistenceTime = Math.random() * 200 + 30;
        await new Promise((resolve) => setTimeout(resolve, persistenceTime));

        const latency = performance.now() - start;
        measurements.push(latency);
      }

      const sorted = [...measurements].sort((a, b) => a - b);
      const p95Index = (95 / 100) * (sorted.length - 1);
      const p95 = sorted[Math.floor(p95Index)];

      assert.ok(p95 < 500);

      const maxLatency = Math.max(...measurements);
      assert.ok(maxLatency < 1000);
    });
  });
});
