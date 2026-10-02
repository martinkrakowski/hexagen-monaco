"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { projectMode } from "@hexagen/shared";
import { useSavedProjects } from "@/hooks/useSavedProjects";
import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";
import {
  BrownfieldViewerPage,
  type IntakeState,
} from "@/brownfield-workbook/BrownfieldViewerPage";
import {
  BUNDLE_LIMITS,
  readBundle,
} from "@/brownfield-workbook/bundle/read-bundle";

/**
 * Container for the brownfield viewer: resolves `?project=<id>` to a saved
 * workbook and hands its name to the presentational page. It mounts no
 * governance, push or generate surface (BW-D7).
 *
 * BW-D2: a chosen bundle is read into memory here and parsed in the browser.
 * It is never uploaded, and nothing from it is written to IndexedDB or any
 * other store; the state below lives only as long as the tab.
 */
const IDLE: IntakeState = { phase: "idle" };

export function BrownfieldViewerClient() {
  const searchParams = useSearchParams();
  const id = searchParams.get("project");
  const { projects, isLoading } = useSavedProjects();
  const { clearActiveWorkspace } = useActiveWorkspace();
  // The bundle belongs to the project id it was opened under: a different id
  // reads as idle, so a second workbook never shows the first one's bundle.
  const [held, setHeld] = useState<{ id: string | null; intake: IntakeState }>({
    id,
    intake: IDLE,
  });
  const intake = held.id === id ? held.intake : IDLE;

  // Only the latest chosen file may set state: a slower earlier read is dropped.
  const latest = useRef(0);

  // A change of project id drops any read still in flight.
  useEffect(() => {
    latest.current++;
  }, [id]);

  const onFile = useCallback(
    async (file: File) => {
      const mine = ++latest.current;
      const apply = (next: IntakeState) => {
        if (latest.current === mine) setHeld({ id, intake: next });
      };
      if (file.size > BUNDLE_LIMITS.maxTotalBytes) {
        apply({
          phase: "refused",
          fileName: file.name,
          errors: [
            `the file is too large (over ${BUNDLE_LIMITS.maxTotalBytes.toLocaleString()} bytes)`,
          ],
        });
        return;
      }
      apply({ phase: "reading", fileName: file.name });
      try {
        const result = await readBundle(
          new Uint8Array(await file.arrayBuffer()),
        );
        apply(
          result.ok
            ? { phase: "ready", fileName: file.name, bundle: result.bundle }
            : { phase: "refused", fileName: file.name, errors: result.errors },
        );
      } catch {
        apply({
          phase: "refused",
          fileName: file.name,
          errors: ["the file could not be read"],
        });
      }
    },
    [id],
  );

  // The shared chrome (Header export/publish) acts on the active workspace.
  // Clear it, as ProjectsLandingShell does, so those controls have no target.
  useEffect(() => {
    clearActiveWorkspace();
  }, [clearActiveWorkspace]);

  if (isLoading)
    return (
      <BrownfieldViewerPage
        name={null}
        status="loading"
        intake={intake}
        onFile={onFile}
      />
    );
  const project = id ? projects.find((p) => p.id === id) : undefined;
  if (!project || projectMode(project) !== "brownfield") {
    return (
      <BrownfieldViewerPage
        name={null}
        status="missing"
        intake={intake}
        onFile={onFile}
      />
    );
  }
  return (
    <BrownfieldViewerPage
      name={project.name}
      status="ready"
      intake={intake}
      onFile={onFile}
    />
  );
}
