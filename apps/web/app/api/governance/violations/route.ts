import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { LinterReportSchema } from "@hexagen/governance";

const execAsync = promisify(exec);

interface Violation {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  context?: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export async function GET() {
  try {
    let valid = true;
    let errors: string[] = [];

    try {
      await execAsync("yarn lint:arch", {
        cwd: process.cwd(),
        timeout: 30000, // 30s timeout to prevent hanging
      });
    } catch (error) {
      valid = false;
      const err = error as Error & { stderr?: string | Buffer };
      const message = err.stderr ? String(err.stderr) : err.message;
      errors = message
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }

    const violations: Violation[] = errors.map((msg, idx) => ({
      id: String(idx + 1),
      type: "error" as const,
      message: msg,
      severity: "HIGH" as const,
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
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run lint" },
      { status: 500 },
    );
  }
}
