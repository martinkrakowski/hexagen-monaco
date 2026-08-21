"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button, Spinner } from "@hexagen/ui";
import { ProjectsShellWithFreeTier } from "@/ProjectsShellWithFreeTier";
import { CreationStepIndicator } from "@/landing/components/CreationStepIndicator";
import { ScanResultPanel } from "@/conformance/ScanResultPanel";
import { CREATION_STEPS } from "@/landing/domain/creation-path";
import { MAX_PROJECT_NAME_CHARS } from "@/lib/project-scan/limits";
import type { ProjectScanResponse } from "@/lib/project-scan/types";

function isScanResponse(value: unknown): value is ProjectScanResponse {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.verdict === "pass" ||
    rec.verdict === "violations" ||
    rec.verdict === "could-not-run"
  );
}

export function ImportScanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const carriedName = searchParams.get("name")?.trim() || "";
  const nameTooLong = carriedName.length > MAX_PROJECT_NAME_CHARS;

  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [result, setResult] = useState<ProjectScanResponse | null>(null);

  useEffect(() => {
    if (!carriedName) {
      router.replace("/projects/new/name?path=scan");
    }
  }, [carriedName, router]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setClientError(null);
    setResult(null);
  };

  const handleScan = useCallback(async () => {
    if (!file || !carriedName || running || nameTooLong) return;
    setClientError(null);
    setResult(null);
    setRunning(true);
    try {
      const form = new FormData();
      form.append("name", carriedName);
      form.append("zip", file, file.name);
      const response = await fetch("/api/projects/scan", {
        method: "POST",
        body: form,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          typeof body === "object" &&
          body !== null &&
          "error" in body &&
          typeof (body as { error: unknown }).error === "string"
            ? (body as { error: string }).error
            : "Scan was rejected.";
        setClientError(message);
        return;
      }
      if (!isScanResponse(body)) {
        setClientError("Scan returned an unexpected response.");
        return;
      }
      setResult(body);
    } catch (err) {
      setClientError(
        err instanceof Error ? err.message : "Could not reach the scan API.",
      );
    } finally {
      setRunning(false);
    }
  }, [file, carriedName, running, nameTooLong]);

  if (!carriedName) {
    return null;
  }

  const canRun = Boolean(file) && !running && !nameTooLong;

  return (
    <ProjectsShellWithFreeTier
      title="Scan existing project"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => router.push("/projects/new/import")}
            disabled={running}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={handleScan} disabled={!canRun}>
            {running ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Scanning
              </>
            ) : (
              "Run scan"
            )}
          </Button>
        </>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="flex items-center justify-center min-h-full py-6 sm:py-12">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 w-full">
            <CreationStepIndicator currentStep={2} steps={CREATION_STEPS} />

            <div className="text-center mb-10 animate-fade-in-up delay-100">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                Scan existing project
              </h1>
              <p className="text-muted-foreground max-w-md mx-auto leading-relaxed">
                Upload a zip of a TypeScript repo. We map workspaces, write a
                layout, optionally bootstrap a manifest, and run hexagen-lint.
              </p>
              <p className="text-sm text-muted-foreground mt-3">
                Project:{" "}
                <span className="font-medium text-foreground">
                  {carriedName}
                </span>
              </p>
            </div>

            <div className="space-y-4 animate-fade-in-up delay-200">
              <label
                htmlFor="project-scan-zip"
                className="block text-sm font-medium text-foreground"
              >
                Upload a zip of the repository
              </label>
              <input
                id="project-scan-zip"
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                aria-describedby="scan-zip-help"
                onChange={handleFileChange}
                disabled={running}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-accent file:text-accent-foreground hover:file:bg-accent/90"
              />
              <p id="scan-zip-help" className="text-sm text-muted-foreground">
                Assisted brownfield adoption — not automated ingestion, not
                inference. You ratify by uploading; the engine does not guess
                depends_on from the import graph.
              </p>
              {file && (
                <p className="text-sm text-foreground">Selected: {file.name}</p>
              )}

              {(clientError || nameTooLong) && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {clientError ??
                    `Project name exceeds ${MAX_PROJECT_NAME_CHARS} characters`}
                </div>
              )}

              {result && (
                <ScanResultPanel
                  verdict={result.verdict}
                  exitCode={result.exitCode}
                  layoutExcerpt={result.layoutExcerpt}
                  filesScanned={result.filesScanned}
                  reportMarkdown={result.reportMarkdown}
                  errorMessage={result.errorMessage}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </ProjectsShellWithFreeTier>
  );
}
