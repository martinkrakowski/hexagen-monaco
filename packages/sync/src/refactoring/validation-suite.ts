export interface SafeRefactoringConfig {
  createBackup: boolean;
  runBuild: boolean;
  runTypecheck: boolean;
  runArchLint: boolean;
  runTests: boolean;
  autoCommit: boolean;
  commitMessage?: string;
}

export interface ValidationResult {
  valid: boolean;
  buildPassed: boolean;
  typecheckPassed: boolean;
  archLintPassed: boolean;
  testsPassed: boolean;
  errors: string[];
}

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

async function validate(
  workspaceRoot: string,
  config: SafeRefactoringConfig,
): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    buildPassed: true,
    typecheckPassed: true,
    archLintPassed: true,
    testsPassed: true,
    errors: [],
  };

  if (config.runBuild) {
    try {
      await execAsync("yarn build", {
        cwd: workspaceRoot,
        timeout: 120_000,
      });
    } catch (error) {
      result.buildPassed = false;
      result.valid = false;
      result.errors.push(`Build failed: ${(error as Error).message}`);
    }
  }

  if (config.runTypecheck) {
    try {
      await execAsync("yarn typecheck", {
        cwd: workspaceRoot,
        timeout: 120_000,
      });
    } catch (error) {
      result.typecheckPassed = false;
      result.valid = false;
      result.errors.push(`Typecheck failed: ${(error as Error).message}`);
    }
  }

  if (config.runArchLint) {
    try {
      await execAsync("yarn lint:arch", {
        cwd: workspaceRoot,
        timeout: 60_000,
      });
    } catch (error) {
      result.archLintPassed = false;
      result.valid = false;
      result.errors.push(`Arch lint failed: ${(error as Error).message}`);
    }
  }

  if (config.runTests) {
    try {
      await execAsync("yarn test", {
        cwd: workspaceRoot,
        timeout: 300_000,
      });
    } catch (error) {
      result.testsPassed = false;
      result.valid = false;
      result.errors.push(`Tests failed: ${(error as Error).message}`);
    }
  }

  return result;
}

export { validate };
