import { MessageSquare } from "lucide-react";
import type { GovernanceEntry } from "@hexagen/local-llm";
import { AnswerArea } from "./answer-area";

interface ThreadEntryProps {
  entry: GovernanceEntry;
  isCurrentlyStreaming: boolean;
  streamingContent: string;
  isRegenerating: boolean;
  onRegenerate: (id: string) => void;
  disabled: boolean;
}

export function ThreadEntry({
  entry,
  isCurrentlyStreaming,
  streamingContent,
  isRegenerating,
  onRegenerate,
  disabled,
}: ThreadEntryProps) {
  const content = isCurrentlyStreaming ? streamingContent : entry.answer;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded flex items-center justify-center bg-primary/10">
          <MessageSquare size={10} className="text-primary" strokeWidth={2.5} />
        </div>
        <p className="text-xs font-medium text-primary">
          {entry.questionLabel}
        </p>
      </div>
      <AnswerArea
        content={content}
        isRegenerating={isRegenerating}
        onRegenerate={onRegenerate}
        entryId={entry.id}
        disabled={disabled}
      />
    </div>
  );
}
