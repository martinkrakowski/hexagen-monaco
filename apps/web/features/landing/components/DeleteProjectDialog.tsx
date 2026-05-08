"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@hexagen/ui";
import { Button } from "@hexagen/ui";

interface DeleteProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  projectName: string;
}

export function DeleteProjectDialog({
  open,
  onClose,
  onConfirm,
  projectName,
}: DeleteProjectDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Project</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &ldquo;{projectName}&rdquo;? This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
