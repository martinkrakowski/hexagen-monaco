import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { isFileUnderModule } from "../src/module-file-scope.js";

/**
 * These cases run identically on every host: the Windows-shaped inputs are
 * written literally rather than derived from `process.platform`, so the
 * regression is covered on the ubuntu leg too.
 */
describe("isFileUnderModule", () => {
  it("matches a ts-morph (forward-slash) file against a WINDOWS native module path", () => {
    // The production defect: hexagen-lint scanned zero files on Windows and
    // exited 2 ("NOTHING WAS CHECKED") for every module.
    assert.equal(
      isFileUnderModule(
        "C:/Users/runneradmin/AppData/Local/Temp/x/packages/billing/src/domain/price.ts",
        "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\x\\packages\\billing",
      ),
      true,
    );
  });

  it("matches on POSIX, where both sides already agree", () => {
    assert.equal(
      isFileUnderModule(
        "/repo/packages/billing/src/x.ts",
        "/repo/packages/billing",
      ),
      true,
    );
  });

  it("matches the module directory itself", () => {
    assert.equal(
      isFileUnderModule(
        "C:/repo/packages/billing",
        "C:\\repo\\packages\\billing",
      ),
      true,
    );
  });

  it("keeps the separator boundary: 'ui' must not match 'ui-projection-compiler'", () => {
    assert.equal(
      isFileUnderModule(
        "C:/repo/packages/ui-projection-compiler/src/x.ts",
        "C:\\repo\\packages\\ui",
      ),
      false,
    );
    assert.equal(
      isFileUnderModule(
        "/repo/packages/ui-projection-compiler/src/x.ts",
        "/repo/packages/ui",
      ),
      false,
    );
  });

  it("tolerates a trailing separator on the module path", () => {
    assert.equal(
      isFileUnderModule(
        "C:/repo/packages/billing/src/x.ts",
        "C:\\repo\\packages\\billing\\",
      ),
      true,
    );
  });

  it("does not match a sibling module", () => {
    assert.equal(
      isFileUnderModule(
        "C:/repo/packages/orders/src/x.ts",
        "C:\\repo\\packages\\billing",
      ),
      false,
    );
  });
});
