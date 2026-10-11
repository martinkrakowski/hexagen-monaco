"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Alert, Button } from "@hexagen/ui";
import { useWorkspaceConflict } from "./hooks/useWorkspaceConflict";

type Stage =
  | { kind: "choices" }
  | { kind: "confirm"; choice: "keep" | "use" }
  | { kind: "busy"; choice: "keep" | "use" };

type Message =
  | { kind: "none" }
  | { kind: "failure"; conflict: { at: string; where: string } | null };

const TITLE = "This project was changed on another device";
const BODY =
  "The editor files in this project were changed here and on another device, and the two copies are different. Until you choose, your changes are saved on this device only.";
const KEEP_LABEL = "Keep this device's copy";
const KEEP_HELPER =
  "The copy in your account is replaced with the one on this device.";
const USE_LABEL = "Use the other device's copy";
const USE_HELPER =
  "The copy on this device is replaced with the one in your account.";
const BUSY_LABEL = "Working...";

export function WorkspaceConflictNotice({
  projectId,
  onReload,
}: {
  projectId: string | null;
  onReload: (projectId: string) => Promise<boolean>;
}) {
  const { conflict, keepThisDevice, useOtherDevice } =
    useWorkspaceConflict(projectId);
  const [stage, setStage] = useState<Stage>({ kind: "choices" });
  const [message, setMessage] = useState<Message>({ kind: "none" });
  const [pendingChoice, setPendingChoice] = useState<"keep" | "use" | null>(
    null,
  );
  const [reloadFailedId, setReloadFailedId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [returnFocus, setReturnFocus] = useState<"keep" | "use" | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const openerButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (conflict === null && stage.kind !== "busy") {
      setStage({ kind: "choices" });
    }
  }, [conflict, stage.kind]);

  useEffect(() => {
    if (
      message.kind === "failure" &&
      conflict !== null &&
      (message.conflict === null ||
        message.conflict.at !== conflict.at ||
        message.conflict.where !== conflict.where)
    ) {
      setMessage({ kind: "none" });
    }
  }, [conflict, message]);

  useEffect(() => {
    if (stage.kind === "confirm") {
      confirmButtonRef.current?.focus();
    }
  }, [stage]);

  useEffect(() => {
    if (stage.kind === "choices" && returnFocus !== null) {
      openerButtonRef.current?.focus();
      setReturnFocus(null);
    }
  }, [stage, returnFocus]);

  const openConfirm = (choice: "keep" | "use") => {
    setPendingChoice(choice);
    setStage({ kind: "confirm", choice });
    setMessage({ kind: "none" });
  };

  const goBack = () => {
    setReturnFocus(pendingChoice);
    setStage({ kind: "choices" });
    setPendingChoice(null);
  };

  const failureMessage = (conflict: { at: string; where: string } | null) => {
    setMessage({ kind: "failure", conflict });
  };

  const confirmKeep = async () => {
    if (projectId === null) return;
    setStage({ kind: "busy", choice: "keep" });
    let ok = false;
    try {
      ok = await keepThisDevice();
    } finally {
      setStage({ kind: "choices" });
      setPendingChoice(null);
    }
    if (!ok) {
      setReturnFocus("keep");
      failureMessage(
        conflict === null ? null : { at: conflict.at, where: conflict.where },
      );
      return;
    }
    setApplied(true);
  };

  const confirmUse = async () => {
    if (projectId === null) return;
    setStage({ kind: "busy", choice: "use" });
    let ok = false;
    let reloaded = false;
    try {
      ok = await useOtherDevice();
      try {
        reloaded = await onReload(projectId);
      } catch {
        reloaded = false;
      }
    } finally {
      setStage({ kind: "choices" });
      setPendingChoice(null);
    }
    if (!reloaded) {
      setReloadFailedId(projectId);
      return;
    }
    setReloadFailedId(null);
    if (!ok) {
      setReturnFocus("use");
      failureMessage(
        conflict === null ? null : { at: conflict.at, where: conflict.where },
      );
      return;
    }
    setApplied(true);
  };

  const retryReload = async () => {
    if (reloadFailedId === null || retrying) return;
    setRetrying(true);
    try {
      const reloaded = await onReload(reloadFailedId);
      if (reloaded) {
        setReloadFailedId(null);
      }
    } finally {
      setRetrying(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && stage.kind === "confirm") {
      event.preventDefault();
      goBack();
    }
  };

  useEffect(() => {
    if (conflict !== null) {
      setApplied(false);
    }
  }, [conflict]);

  const liveRegion = (
    <div className="sr-only" aria-live="polite">
      {applied ? "Your choice was applied." : ""}
    </div>
  );

  if (conflict === null && message.kind === "none" && reloadFailedId === null) {
    return liveRegion;
  }

  const busy = stage.kind === "busy";
  const busyChoice = busy ? stage.choice : null;

  const choiceButton = (
    choice: "keep" | "use",
    label: string,
    helper: string,
    variant: "default" | "outline",
  ) => (
    <div className="flex flex-col gap-1">
      <Button
        ref={returnFocus === choice ? openerButtonRef : undefined}
        variant={variant}
        disabled={busy}
        onClick={() => openConfirm(choice)}
      >
        {busyChoice === choice ? BUSY_LABEL : label}
      </Button>
      <p className="text-xs text-muted-foreground">{helper}</p>
    </div>
  );

  let content: ReactNode;
  if (reloadFailedId !== null) {
    content = (
      <Alert tone="danger" title="The project could not be reloaded">
        <p>Your edits are not being saved right now.</p>
        <div className="mt-2">
          <Button
            variant="outline"
            disabled={retrying}
            onClick={() => void retryReload()}
          >
            {retrying ? BUSY_LABEL : "Reload project"}
          </Button>
        </div>
      </Alert>
    );
  } else {
    const failureAlert =
      message.kind === "failure" ? (
        conflict !== null ? (
          <Alert tone="danger" title="Your choice could not be applied">
            <p>Please try again.</p>
          </Alert>
        ) : (
          <Alert tone="danger" title="Your choice could not be completed">
            <p>
              The editor now shows the copy that is on this device. Check your
              files before you go on.
            </p>
            <div className="mt-2">
              <Button
                variant="outline"
                onClick={() => setMessage({ kind: "none" })}
              >
                Dismiss
              </Button>
            </div>
          </Alert>
        )
      ) : null;
    const confirmingChoice =
      stage.kind === "busy"
        ? stage.choice
        : stage.kind === "confirm"
          ? pendingChoice
          : null;
    const mainAlert =
      confirmingChoice === "keep" ? (
        <Alert tone="warning" title="Replace the copy in your account?">
          <p>
            The changes made on the other device will no longer be in this
            project.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button
              ref={confirmButtonRef}
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmKeep()}
            >
              {busy ? BUSY_LABEL : "Replace account copy"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={goBack}>
              Go back
            </Button>
          </div>
        </Alert>
      ) : confirmingChoice === "use" ? (
        <Alert tone="warning" title="Replace the copy on this device?">
          <p>
            The changes made on this device will no longer be in this project.
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button
              ref={confirmButtonRef}
              variant="destructive"
              disabled={busy}
              onClick={() => void confirmUse()}
            >
              {busy ? BUSY_LABEL : "Replace this device's copy"}
            </Button>
            <Button variant="outline" disabled={busy} onClick={goBack}>
              Go back
            </Button>
          </div>
        </Alert>
      ) : (
        <Alert tone="warning" title={TITLE}>
          <p>{BODY}</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            {choiceButton("keep", KEEP_LABEL, KEEP_HELPER, "default")}
            {choiceButton("use", USE_LABEL, USE_HELPER, "outline")}
          </div>
        </Alert>
      );
    content = (
      <>
        {failureAlert}
        {mainAlert}
      </>
    );
  }

  return (
    <div
      aria-busy={busy ? "true" : undefined}
      onKeyDown={onKeyDown}
      className="mx-4 mt-2 shrink-0 flex flex-col gap-2"
    >
      {content}
      {liveRegion}
    </div>
  );
}
