"use client";

import type { ReactNode } from "react";
import { Accordion } from "@hexagen/ui";

import { TwoPaneLayout } from "../resizable-layout/TwoPaneLayout";

/**
 * Which resource the workbench's right pane shows (Plan Workbench A2). PR B
 * adds the add-session view and moves the selection into a `?layer=` URL
 * param; until then the host keeps it as local state.
 */
export type WorkbenchMainView =
  | { readonly kind: "live" }
  | { readonly kind: "layer"; readonly layerId: string };

export interface PlanWorkbenchProps {
  /** Section A content — the A1 project-settings field set. */
  settings: ReactNode;
  /** Section B content — the live-session row + archived layer rows. */
  sessions: ReactNode;
  /**
   * Optional third accordion section — "Generation options" (Plan Workbench
   * C2, plan §3.6). Only the GENESIS host fills it (the deployment /
   * max-contexts / engine controls relocated out of the right pane); the
   * plan-phase host omits it and the section never renders — zero behavior
   * change for `phase=plan`.
   */
  generationOptions?: ReactNode;
  /** Pinned under the left column (desktop) / under both tabs (mobile). */
  leftFooter?: ReactNode;
  /** The right pane's main area (live session view or a layer reader). */
  main: ReactNode;
  /** Pinned under the main area (the seed/steering composer), if any. */
  composer?: ReactNode;
  /** Desktop left-pane header title + mobile left tab label. */
  leftTitle: string;
  /** Mobile right tab label (the desktop right pane has no header). */
  rightTitle: string;
}

/**
 * PRESENTATIONAL two-pane plan workbench (Plan Workbench A2): left column =
 * "Project settings" + "Sessions & sources" accordion sections, right column =
 * main view + optional composer. Purely slot-based — the plan host
 * (PlanPhaseView) owns every piece of data and behavior via props; nothing
 * here (or below) reads an app context, so the component renders under any
 * host that fills the slots.
 */
export function PlanWorkbench({
  settings,
  sessions,
  generationOptions,
  leftFooter,
  main,
  composer,
  leftTitle,
  rightTitle,
}: PlanWorkbenchProps) {
  return (
    <TwoPaneLayout
      leftTitle={leftTitle}
      rightTitle={rightTitle}
      leftFooter={leftFooter}
      left={
        <Accordion.Root
          type="multiple"
          // All sections start open: the workbench is the plan phase's whole
          // surface, and a collapsed-by-default settings section would hide
          // the A1 autosave fields behind an extra click. "generation-options"
          // is listed unconditionally — the uncontrolled Root captures
          // defaultValue once at mount, and the genesis host's slot content
          // can appear AFTER mount (it is absent during generation), so the
          // default must already cover it; a value with no matching item is
          // inert for the plan-phase host.
          defaultValue={["settings", "sessions", "generation-options"]}
          className="px-4"
        >
          <Accordion.Item value="settings">
            {/* Heading wraps the Trigger per the WAI-ARIA accordion pattern
                (see Accordion.Trigger's JSDoc); h2 = top level inside the pane. */}
            <h2>
              <Accordion.Trigger>Project settings</Accordion.Trigger>
            </h2>
            {/* Accordion.Content unmounts its children when closed — safe for
                the settings form because useProjectSettingsAutosave flushes
                pending edits on unmount. */}
            <Accordion.Content>{settings}</Accordion.Content>
          </Accordion.Item>
          <Accordion.Item
            value="sessions"
            className={generationOptions ? undefined : "border-b-0"}
          >
            <h2>
              <Accordion.Trigger>Sessions &amp; sources</Accordion.Trigger>
            </h2>
            <Accordion.Content>{sessions}</Accordion.Content>
          </Accordion.Item>
          {generationOptions && (
            <Accordion.Item value="generation-options" className="border-b-0">
              <h2>
                <Accordion.Trigger>Generation options</Accordion.Trigger>
              </h2>
              <Accordion.Content>{generationOptions}</Accordion.Content>
            </Accordion.Item>
          )}
        </Accordion.Root>
      }
      right={
        <div className="flex h-full flex-col">
          {/* overflow-hidden, not auto: each main view owns its scroll region
              so a reader's header (or the live view's) can stay pinned. */}
          <div className="flex-1 min-h-0 overflow-hidden">{main}</div>
          {composer}
        </div>
      }
    />
  );
}
