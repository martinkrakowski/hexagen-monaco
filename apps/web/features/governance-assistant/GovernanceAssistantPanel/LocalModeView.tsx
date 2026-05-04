"use client";

import { LocalModeBootView } from "./LocalModeBootView";
import { LocalModeProgressView } from "./LocalModeProgressView";
import { LocalModeSettingsView } from "./LocalModeSettingsView";
import type { ModeWrapperProps } from "./types";

type LocalModeViewProps = Pick<
  ModeWrapperProps,
  | "llmEngineState"
  | "showBootSpinner"
  | "showUnavailable"
  | "showWakingUp"
  | "showProgress"
  | "showError"
  | "showRequiresModel"
  | "onRefresh"
  | "isLoading"
  | "onCancelDownload"
  | "onOpenSettings"
  | "onInitModel"
  | "onBackFromSettings"
  | "onSwitchToCloud"
  | "loadedModel"
  | "messagesLength"
  | "onSwitchModel"
  | "onDeleteModel"
  | "hasModelInCache"
  | "panelView"
>;

export function LocalModeView(props: LocalModeViewProps) {
  const bootView = (
    <LocalModeBootView
      showBootSpinner={props.showBootSpinner}
      showUnavailable={props.showUnavailable}
      showWakingUp={props.showWakingUp}
      llmEngineState={props.llmEngineState}
      onCancelDownload={props.onCancelDownload}
    />
  );

  if (props.showBootSpinner || props.showUnavailable || props.showWakingUp) {
    return bootView;
  }

  const progressView = (
    <LocalModeProgressView
      showProgress={props.showProgress}
      showError={props.showError}
      llmEngineState={props.llmEngineState}
      onOpenSettings={props.onOpenSettings}
      onInitModel={props.onInitModel}
      loadedModel={props.loadedModel}
    />
  );

  if (props.showProgress || props.showError) {
    return progressView;
  }

  return (
    <LocalModeSettingsView
      panelView={props.panelView}
      showRequiresModel={props.showRequiresModel}
      llmEngineState={props.llmEngineState}
      loadedModel={props.loadedModel}
      messagesLength={props.messagesLength}
      onSwitchModel={props.onSwitchModel}
      onDeleteModel={props.onDeleteModel}
      hasModelInCache={props.hasModelInCache}
      onBackFromSettings={props.onBackFromSettings}
      onSwitchToCloud={props.onSwitchToCloud}
    />
  );
}
