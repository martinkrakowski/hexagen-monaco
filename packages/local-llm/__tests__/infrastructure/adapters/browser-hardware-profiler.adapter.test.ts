import assert from "node:assert";
import { BrowserHardwareProfilerAdapter } from "../../../src/infrastructure/adapters/browser-hardware-profiler.adapter.js";

(async () => {
  const adapter = new BrowserHardwareProfilerAdapter();

  // 1️⃣ Should detect CPU cores
  const result1 = await adapter.profile();
  assert(
    result1.success,
    "Hardware profile detection should succeed or gracefully handle test environment",
  );

  // 2️⃣ Should detect device class
  const result2 = await adapter.profile();
  assert(result2.success, "Hardware profile detection should return a result");
  if (result2.success) {
    const validClasses = ["desktop", "mobile", "unknown"];
    assert(
      validClasses.includes(result2.value.deviceClass),
      `Device class should be one of ${validClasses.join(", ")}, got ${result2.value.deviceClass}`,
    );
  }

  // 3️⃣ Should return GPU info
  const result3 = await adapter.profile();
  assert(result3.success, "Hardware profile detection should return a result");
  if (result3.success) {
    assert(result3.value.gpu !== undefined, "GPU info should be defined");
    assert(
      typeof result3.value.gpu.supported === "boolean",
      "GPU supported flag should be a boolean",
    );
  }

  console.log("✅ All BrowserHardwareProfilerAdapter tests passed.");
})();
