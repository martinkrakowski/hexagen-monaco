import { useRef } from "react";

export interface UseDialogOptions {
  isOpen: boolean;
  onClose: () => void;
  isDismissable?: boolean;
}

export interface UseDialogReturn {
  dialogProps: Record<string, unknown>;
  overlayProps: Record<string, unknown>;
  modalProps: Record<string, unknown>;
}

export function useDialog(options: UseDialogOptions): UseDialogReturn {
  useRef<HTMLElement>(null);

  const overlayProps: Record<string, unknown> = {
    "aria-hidden": !options.isOpen,
  };

  const modalProps: Record<string, unknown> = {
    inert: !options.isOpen ? "" : undefined,
  };

  const dialogProps: Record<string, unknown> = {
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": undefined,
  };

  return {
    dialogProps,
    overlayProps,
    modalProps,
  };
}