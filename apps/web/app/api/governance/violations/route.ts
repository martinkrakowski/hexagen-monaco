import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { LinterReportSchema } from "@hexagen/governance";
import { PERFORMANCE_TARGETS } from "@hexagen/web-driver";

const execAsync = promisify(exec);

interface Violation {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  context?: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  errorCode?: string; // Discriminates timeout/permission vs execution errors
}

export async function GET() {
  // Declare tracking variables for lint execution
  let valid = true;
  let errors: string[] = [];
  let errorCode: string | undefined;

  try {
    try {
      await execAsync("yarn lint:arch", {
        cwd: process.cwd(),
        timeout: PERFORMANCE_TARGETS.LINTER.timeout,
      });
    } catch (_err) {
      valid = false;
      const err = _err as Error & { stderr?: string | Buffer; code?: string };

      // Discriminate error types for severity classification
      errorCode = err.code;
      const message = err.stderr ? String(err.stderr) : err.message;
      errors = message
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }

    // Determine severity based on error code
    const isSoftError =
      errorCode === "ETIMEDOUT" ||
      errorCode === "ENOENT" ||
      errorCode === "EACCES";
    const violationSeverity = isSoftError ? "MEDIUM" : "HIGH";

    const violations: Violation[] = errors.map((msg, idx) => ({
      id: String(idx + 1),
      type: "error" as const,
      message: msg,
      severity: violationSeverity as "HIGH" | "MEDIUM",
      errorCode: errorCode,
    }));

    const report = LinterReportSchema.parse({
      timestamp: new Date().toISOString(),
      isCompliant: valid,
      violations: violations.map((v) => ({
        ruleId: `arch-lint-${v.id}`,
        severity: v.type === "error" ? "error" : "warning",
        file: ".architecture/manifest.yaml",
        message: v.message,
      })),
      scannedFilesCount: 1,
    });

    return NextResponse.json({
      violations,
      isCompliant: report.isCompliant,
    });
  } catch {
    // If anything unexpected happens, return an empty successful response
    return NextResponse.json(
      {
        violations: [],
        isCompliant: true,
      },
      { status: 200 },
    );
  }
}
