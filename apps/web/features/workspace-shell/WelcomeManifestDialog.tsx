import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@hexagen/ui";
import { WelcomeScreen } from "../manifest-generation/WelcomeScreen";

/**
 * Props for the WelcomeManifestDialog component.
 */
interface WelcomeManifestDialogProps {
  /** Whether the dialog is open and visible */
  open: boolean;
  /** Callback fired when the dialog should be closed */
  onClose: () => void;
  /** Optional callback fired when a generated manifest is ready to be used */
  onUseManifest?: (manifest: string) => void;
}

/**
 * A dialog component that presents the WelcomeScreen to the user.
 * Allows users to generate a hexagonal architecture manifest by describing
 * their project in natural language.
 *
 * @param props - Component properties
 */
export function WelcomeManifestDialog({
  open,
  onClose,
  onUseManifest,
}: WelcomeManifestDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="w-full max-w-4xl">
        <DialogHeader>
          <DialogTitle>Generate Manifest from AI</DialogTitle>
          <DialogDescription>
            Describe your project in natural language to generate a complete
            hexagonal architecture manifest
          </DialogDescription>
        </DialogHeader>
        <WelcomeScreen onUseManifest={onUseManifest} />
      </DialogContent>
    </Dialog>
  );
}