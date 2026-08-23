"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProjectNameStep } from "@/landing/components/ProjectNameStep";
import { createDefaultProjectConfig } from "@/project-config-presets";
import { useSavedProjects } from "@/hooks/useSavedProjects";
import { logger } from "../../../../lib/structured-logger";

/**
 * Streams that route through the shared Project Name step.
 *
 * ## Why `github` is absent, and why that is not an oversight
 *
 * `IMPORT_SUB_OPTIONS` has four import ids — `spec`, `scan`, `artifacts` and
 * `github` — and only the first three appear here. The omission is deliberate:
 *
 * - `github`'s href is `/projects/new/import/github` directly, not
 *   `/projects/new/name?path=github`. It is the ONE import stream that does not
 *   route through this step.
 * - `GithubScanPage` (BF-5.3) carries its own project-name field, precisely so
 *   a direct link to that route is a complete entry point rather than a bounce
 *   back to a step the user did not ask for. Adding a `github` branch here
 *   would give one tier two naming surfaces, and the name step would be the one
 *   nobody linked to.
 * - It still ACCEPTS a carried name (`?name=`) and prefills from it, which is
 *   how the brownfield tier picker hands off. That is a carry, not a step.
 *
 * The unknown-path behaviour below is therefore load-bearing rather than
 * incidental: `isNamedPath("github")` is false, `PATH_COPY` is never indexed
 * with it, and the effect redirects to `/projects/new`. Anyone who hand-types
 * `?path=github` is sent to choose again rather than shown a nameless form —
 * the same treatment as any other unrecognised value. If `github` ever needs a
 * name step, the change is: add it to the union, `PATH_COPY`, `isNamedPath`,
 * the submit dispatch and the `handleBack` import-sub-path list, and repoint
 * the `IMPORT_SUB_OPTIONS` href. Five places, all in this file bar the last.
 */
type NamedPath = "blank" | "ai" | "spec" | "scan" | "artifacts";

const PATH_COPY: Record<NamedPath, { title: string; description: string }> = {
  blank: {
    title: "Name your project",
    description:
      "This becomes your saved project name and the name of the generated workspace.",
  },
  ai: {
    title: "Name your project",
    description:
      "Name it first — the AI fills in the architecture next. Used for your saved project and generated workspace.",
  },
  spec: {
    title: "Name your project",
    description:
      "Name it before importing your manifest or spec. Used for your saved project and generated workspace.",
  },
  scan: {
    title: "Name your project",
    description:
      "Name it before scanning a zip of an existing TypeScript repo. Used for your saved project and generated workspace.",
  },
  artifacts: {
    title: "Name your project",
    description:
      "Name it before uploading the artifacts from your local `hexagen scan --handoff`. Used for your saved project and generated workspace.",
  },
};

function isNamedPath(value: string | null): value is NamedPath {
  return (
    value === "blank" ||
    value === "ai" ||
    value === "spec" ||
    value === "scan" ||
    value === "artifacts"
  );
}

/**
 * Shared "Project Name" step orchestrator for every Create stream. Reads the
 * target stream from `?path=` and, on submit, dispatches:
 *  - blank  → build + persist a blank project, then open the wizard
 *  - ai/spec/scan/artifacts → carry the name forward via `?name=` to the stream entry,
 *    where it becomes the saved name and seeds `governance.workspaceName`.
 */
export function NameStepClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { saveProject } = useSavedProjects();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = searchParams.get("path");
  const validPath = isNamedPath(path);

  useEffect(() => {
    // Unknown/missing path — nothing to name. Send the user back to choose.
    if (!validPath) router.replace("/projects/new");
  }, [validPath, router]);

  const handleSubmit = useCallback(
    async (name: string) => {
      setError(null);

      if (path === "blank") {
        setBusy(true);
        try {
          const projectId = await saveProject(
            name,
            createDefaultProjectConfig(name),
            "",
          );
          if (projectId) {
            // Keep `busy` set while navigating away on success.
            router.push(`/wizard/1?project=${projectId}`);
            return;
          }
          // Persistence reported failure (returned null) — surface it instead
          // of silently doing nothing, mirroring the previous flow.
          logger.error("Failed to create blank project: persistence failed");
          setError(
            "Couldn't create the project — check your browser storage permissions or available space and try again.",
          );
        } catch (err) {
          // saveProject doesn't catch port rejections; guard so a throw can't
          // leave the UI stuck on a disabled, busy screen.
          logger.error("Failed to create blank project", {
            error: err instanceof Error ? err.message : String(err),
          });
          setError("Unexpected error creating the project. Please try again.");
        }
        setBusy(false);
        return;
      }

      const encoded = encodeURIComponent(name);
      if (path === "ai") {
        router.push(`/projects/new/ai?name=${encoded}`);
      } else if (path === "spec") {
        router.push(`/projects/new/import/spec?name=${encoded}`);
      } else if (path === "scan") {
        router.push(`/projects/new/import/scan?name=${encoded}`);
      } else if (path === "artifacts") {
        router.push(`/projects/new/import/artifacts?name=${encoded}`);
      }
    },
    [path, router, saveProject],
  );

  const handleBack = useCallback(() => {
    // Import sub-paths return to the import method picker; blank/ai return to the
    // top-level creation path selection.
    if (path === "spec" || path === "scan" || path === "artifacts") {
      router.push("/projects/new/import");
    } else {
      router.push("/projects/new");
    }
  }, [path, router]);

  if (!validPath) {
    return null;
  }

  const copy = PATH_COPY[path];

  return (
    <ProjectNameStep
      title={copy.title}
      description={copy.description}
      busy={busy}
      error={error}
      onSubmit={handleSubmit}
      onBack={handleBack}
    />
  );
}
