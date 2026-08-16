"use client";

import type { ReactNode } from "react";

import { useActiveWorkspace } from "@/contexts/ActiveWorkspaceContext";

import { ProjectExportRecordProvider } from "./ProjectExportRecordContext";
import { ZipExportProvider } from "./ZipExportContext";
import { GithubPublishProvider } from "./GithubPublishContext";

/**
 * Composition root for the export/publish surfaces (GOD-004).
 *
 * This module used to BE the provider: one 697-line component that owned the
 * ZIP request, the GitHub scaffold publish, the editor push, the IDB reads and
 * writes, the imported-manifest fail-closed policy and the dialog state
 * machine, all published through a single context value. The three concerns
 * now live behind three contexts, mounted here in dependency order:
 *
 *   ProjectExportRecordProvider  the active project's saved publish record
 *     └─ ZipExportProvider       the ZIP request + download
 *        └─ GithubPublishProvider  the publish dialogs, scaffold and push
 *
 * The nesting is what makes the separation observable rather than cosmetic: a
 * GitHub state transition re-renders only the innermost provider, so a ZIP
 * consumer no longer re-renders when the publish dialog opens. The
 * imported-manifest policy left the tree entirely — it is
 * `resolveImportedManifestPayload` in `@/lib/imported-manifest`, shared with
 * the code-view generation and architecture-ZIP paths (REA-005).
 *
 * `onEditorPushed` (the workspace's `clearUnpushed`) lets a modal-initiated
 * editor push clear the live "unpushed" flag, keeping the editor toolbar's
 * Push button in sync.
 */
export function ExportProvider({
  children,
  onEditorPushed,
}: {
  children: ReactNode;
  onEditorPushed?: () => void;
}) {
  const { activeWorkspace } = useActiveWorkspace();
  // Destructure only the export-relevant fields so that isDirty/lastModifiedAt
  // changes (triggered on every editor keystroke) do not invalidate the
  // callback identities that feed into the context values.
  const projectId = activeWorkspace?.projectId;
  const projectName = activeWorkspace?.name;
  const wizardData = activeWorkspace?.wizardData;

  return (
    <ProjectExportRecordProvider projectId={projectId}>
      <ZipExportProvider
        projectId={projectId}
        projectName={projectName}
        wizardData={wizardData}
        canExport={activeWorkspace !== null}
      >
        <GithubPublishProvider
          projectId={projectId}
          wizardData={wizardData}
          onEditorPushed={onEditorPushed}
        >
          {children}
        </GithubPublishProvider>
      </ZipExportProvider>
    </ProjectExportRecordProvider>
  );
}
