import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@hexagen/ui";
import { WelcomeScreen } from "../manifest-generation/WelcomeScreen";
import type { LocalLLMContext } from "../../lib/llm-interfaces";

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
  /** LLM context for local model management */
  llmContext: LocalLLMContext;
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
  llmContext,
}: WelcomeManifestDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="w-full max-w-5xl p-0 bg-cinematic-border-vivid rounded-lg">
        <div className="bg-card rounded-md p-2">
          <div className="space-y-6 px-6 py-4 sm:py-6">
            <DialogHeader>
              <DialogTitle>Generate Manifest from AI</DialogTitle>
              <DialogDescription>
                Describe your project in natural language to generate a complete
                hexagonal architecture manifest
              </DialogDescription>
            </DialogHeader>
            <WelcomeScreen
              onUseManifest={onUseManifest}
              llmContext={llmContext}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
