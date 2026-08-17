"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import type { NoSemanticState } from "../types/forbidden-brand.js";

const DialogIdContext = React.createContext<string>("");

export type DialogProps = NoSemanticState<{
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * When false, Escape and backdrop clicks do NOT close the dialog (e.g. a
   * long-running operation that must finish). Default true. Closing it
   * programmatically via the `open` prop still works.
   */
  dismissible?: boolean;
}>;

function Dialog({ open, onClose, children, dismissible = true }: DialogProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  // Set while we close the native <dialog> ourselves (from the effect below),
  // so the resulting `close` event doesn't echo back into the consumer's
  // onClose — which would double-fire on every programmatic close.
  const closingRef = React.useRef(false);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) {
        closingRef.current = true;
        dialog.close();
      }
    }
  }, [open]);

  const handleClose = () => {
    if (closingRef.current) {
      closingRef.current = false;
      return;
    }
    onClose();
  };

  const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    // Escape fires `cancel` (cancelable) before `close`. Preventing it stops
    // the browser from force-closing a non-dismissible dialog out from under
    // the controlled `open` prop.
    if (!dismissible) e.preventDefault();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (!dismissible) return;
    if (e.target === dialogRef.current) onClose();
  };

  return (
    <DialogIdContext.Provider value={titleId}>
      <dialog
        ref={dialogRef}
        onClose={handleClose}
        onCancel={handleCancel}
        onClick={handleBackdropClick}
        aria-labelledby={titleId}
        aria-modal="true"
        className="bg-transparent p-0 m-0 max-w-none max-h-none w-full h-full open:flex items-center justify-center"
      >
        {open && children}
      </dialog>
    </DialogIdContext.Provider>
  );
}
Dialog.displayName = "Dialog";

export type DialogContentProps = NoSemanticState<
  React.HTMLAttributes<HTMLDivElement>
>;

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "bg-card text-card-foreground border border-border rounded-md shadow-lg p-6 w-full max-w-md overscroll-contain",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
      role="document"
      {...props}
    >
      {children}
    </div>
  ),
);
DialogContent.displayName = "DialogContent";

export type DialogHeaderProps = NoSemanticState<
  React.HTMLAttributes<HTMLDivElement>
>;

const DialogHeader = React.forwardRef<HTMLDivElement, DialogHeaderProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1.5 mb-4", className)}
      {...props}
    />
  ),
);
DialogHeader.displayName = "DialogHeader";

export type DialogTitleProps = NoSemanticState<
  React.HTMLAttributes<HTMLHeadingElement>
>;

const DialogTitle = React.forwardRef<HTMLHeadingElement, DialogTitleProps>(
  ({ className, children, ...props }, ref) => {
    const id = React.useContext(DialogIdContext);
    return (
      <h2
        ref={ref}
        id={id || undefined}
        className={cn(
          "text-lg font-semibold leading-none tracking-tight",
          className,
        )}
        {...props}
      >
        {children}
      </h2>
    );
  },
);
DialogTitle.displayName = "DialogTitle";

export type DialogDescriptionProps = NoSemanticState<
  React.HTMLAttributes<HTMLParagraphElement>
>;

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  DialogDescriptionProps
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export type DialogFooterProps = NoSemanticState<
  React.HTMLAttributes<HTMLDivElement>
>;

const DialogFooter = React.forwardRef<HTMLDivElement, DialogFooterProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex justify-end gap-3 mt-6", className)}
      {...props}
    />
  ),
);
DialogFooter.displayName = "DialogFooter";

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
};
