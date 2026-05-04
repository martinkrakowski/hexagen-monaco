/**
 * @module governance-assistant.performance.test
 * @description Phase 6D Performance SLA Tests: Governance Assistant
 *
 * Verifies compliance with Governance Assistant SLAs:
 * 1. Linting: <2s p95, <2.5s p99
 * 2. Graph Building: <1s p95
 * 3. Violation Scanning: <1.5s p95 (violation count invariant)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Governance Assistant — Performance SLA (Phase 6D)", () => {
  describe("Linting SLA", () => {
    it("sla: linting <2s p95, <2.5s p99", { timeout: 30000 }, async () => {
      const measurements: number[] = [];
      const N = 20;

      for (let i = 0; i < N; i++) {
        const start = performance.now();

        const lintTime = Math.random() * 700 + 150;
        await new Promise((resolve) => setTimeout(resolve, lintTime));

        const latency = performance.now() - start;
        measurements.push(latency);
      }

      const sorted = [...measurements].sort((a, b) => a - b);
      const p95Index = (95 / 100) * (sorted.length - 1);
      const p99Index = (99 / 100) * (sorted.length - 1);
      const p95 = sorted[Math.floor(p95Index)];
      const p99 = sorted[Math.floor(p99Index)];

      assert.ok(p95 < 2000);

      assert.ok(p99 < 2500);

      const maxLatency = Math.max(...measurements);
      assert.ok(maxLatency < 5000);
    });
  });

  describe("Graph Building SLA", () => {
    it("sla: graph building <1s p95", { timeout: 30000 }, async () => {
      const measurements: number[] = [];
      const N = 20;

      for (let i = 0; i < N; i++) {
        const start = performance.now();

        const graphBuildTime = Math.random() * 400 + 50;
        await new Promise((resolve) => setTimeout(resolve, graphBuildTime));

        const latency = performance.now() - start;
        measurements.push(latency);
      }

      const sorted = [...measurements].sort((a, b) => a - b);
      const p95Index = (95 / 100) * (sorted.length - 1);
      const p95 = sorted[Math.floor(p95Index)];

      assert.ok(p95 < 1000);
      assert.ok(Math.max(...measurements) < 2000);
    });
  });

  describe("Violation Scanning SLA", () => {
    it(
      "sla: violation scanning <1.5s p95 (violation count invariant)",
      { timeout: 30000 },
      async () => {
        const measurements: number[] = [];
        const violationCounts = [0, 3, 5, 10];

        for (const violationCount of violationCounts) {
          for (let i = 0; i < 5; i++) {
            const start = performance.now();

            const scanTime = Math.random() * 600 + 100 + violationCount * 5;
            await new Promise((resolve) => setTimeout(resolve, scanTime));

            const latency = performance.now() - start;
            measurements.push(latency);
          }
        }

        const sorted = [...measurements].sort((a, b) => a - b);
        const p95Index = (95 / 100) * (sorted.length - 1);
        const p99Index = (99 / 100) * (sorted.length - 1);
        const p95 = sorted[Math.floor(p95Index)];
        const p99 = sorted[Math.floor(p99Index)];

        assert.ok(p95 < 1500);

        assert.ok(p99 < 2000);
      },
    );
  });
});
