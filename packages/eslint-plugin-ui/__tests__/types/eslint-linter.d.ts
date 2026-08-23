/**
 * Minimal declaration for the one eslint surface the population-guard test
 * uses. eslint@8 ships no bundled types and @types/eslint is not a
 * dependency of this package; declaring the three members used here is
 * smaller than adding one for a single test file.
 */
declare module "eslint" {
  interface LintMessage {
    ruleId: string | null;
    message: string;
  }

  interface FlatConfigItem {
    files?: string[];
    plugins?: Record<string, unknown>;
    rules?: Record<string, unknown>;
  }

  export class Linter {
    constructor(options?: { configType?: "flat" | "eslintrc" });
    verify(
      code: string,
      config: FlatConfigItem[],
      filename?: string,
    ): LintMessage[];
  }
}
