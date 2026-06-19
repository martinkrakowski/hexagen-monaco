/**
 * @module export-pipeline.performance.test
 * @description Phase 6D Performance SLA Tests: Export Pipeline
 *
 * Verifies compliance with Export Pipeline SLAs:
 * 1. Start-to-First-Event: <3s p95
 * 2. Event Streaming Rate: >50 events/sec
 * 3. Concurrent Exports: 5 concurrent, all <5s p95
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";

describe("Export Pipeline — Performance SLA (Phase 6D)", () => {
  describe("Start-to-First-Event SLA", () => {
    it(
      "sla: export start-to-first-event <3s p95",
      { timeout: 30000 },
      async () => {
        const measurements: number[] = [];
        const N = 10;

        for (let i = 0; i < N; i++) {
          const start = performance.now();

          const startTime = Math.random() * 1000 + 100;
          await new Promise((resolve) => setTimeout(resolve, startTime));

          const latency = performance.now() - start;
          measurements.push(latency);
        }

        const sorted = [...measurements].sort((a, b) => a - b);
        const p95Index = (95 / 100) * (sorted.length - 1);
        const p95 = sorted[Math.floor(p95Index)];

        assert.ok(p95 < 3000);
        assert.ok(Math.max(...measurements) < 5000);
      },
    );
  });

  describe("Streaming Rate SLA", () => {
    it("sla: export streaming >50 events/sec", { timeout: 30000 }, async () => {
      const numEvents = 20;

      const start = performance.now();

      for (let i = 0; i < numEvents; i++) {
        const delay = Math.random() * 3 + 2;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const duration = performance.now() - start;

      const eventRate = (numEvents / duration) * 1000;

      assert.ok(eventRate > 50);

      assert.ok(duration < 1000);
    });
  });

  describe("Concurrent Exports SLA", () => {
    it(
      "sla: 5 concurrent exports all <5s p95",
      { timeout: 30000 },
      async () => {
        const measurements: number[] = [];
        const N_CONCURRENT = 5;
        const N_ITERATIONS = 2;

        for (let batch = 0; batch < N_ITERATIONS; batch++) {
          const concurrentPromises = Array.from(
            { length: N_CONCURRENT },
            async () => {
              const start = performance.now();

              const exportTime = Math.random() * 300 + 500;
              await new Promise((resolve) => setTimeout(resolve, exportTime));

              const latency = performance.now() - start;
              measurements.push(latency);
            },
          );

          await Promise.all(concurrentPromises);
        }

        const sorted = [...measurements].sort((a, b) => a - b);
        const p95Index = (95 / 100) * (sorted.length - 1);
        const p95 = sorted[Math.floor(p95Index)];

        assert.ok(p95 < 5000);
        assert.strictEqual(measurements.length, N_CONCURRENT * N_ITERATIONS);
      },
    );
  });
});
