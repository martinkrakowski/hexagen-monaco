"use client";

import {
  SectionLabel,
  QuestionAccordion,
  ThinkingIndicator,
  ThreadEntry,
  FollowUpTag,
} from "../../governance";
import type { QuestionsSectionProps } from "../types";
import type { GovernanceEntry } from "@hexagen/local-llm";

export function QuestionsSection({
  displayQuestions,
  activeItem,
  isStreaming,
  isExpanded,
  onQuestionClick,
  conversationThread,
  lastAssistantMessage,
  regeneratingEntryId,
  onRegenerate,
  followUpQuestions,
  onFollowUpClick,
  threadLoaded,
}: QuestionsSectionProps) {
  return (
    <div className="mt-5">
      <SectionLabel label={activeItem ? "Item Questions" : "Step Questions"} />
      <div className="space-y-3">
        {displayQuestions.map((q) => {
          const expanded = isExpanded(q.id);
          const isCurrentlyStreaming =
            isStreaming &&
            expanded &&
            conversationThread.length > 0 &&
            !conversationThread[conversationThread.length - 1].answer;

          return (
            <QuestionAccordion
              key={q.id}
              question={q}
              isExpanded={expanded}
              onToggle={() => onQuestionClick(q)}
              disabled={isStreaming}
            >
              {threadLoaded && (
                <>
                  {conversationThread.length === 0 && <ThinkingIndicator />}
                  {conversationThread.length > 0 && (
                    <div className="space-y-4 mb-4">
                      {conversationThread.map((entry, i) => {
                        const entryWithQuestion: GovernanceEntry = {
                          ...entry,
                          questionLabel: entry.questionLabel || "",
                        } as GovernanceEntry;
                        return (
                          <ThreadEntry
                            key={entry.id}
                            entry={entryWithQuestion}
                            isCurrentlyStreaming={
                              isCurrentlyStreaming &&
                              i === conversationThread.length - 1
                            }
                            streamingContent={lastAssistantMessage}
                            isRegenerating={regeneratingEntryId === entry.id}
                            onRegenerate={onRegenerate}
                            disabled={isStreaming}
                          />
                        );
                      })}
                    </div>
                  )}

                  {followUpQuestions.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60 mb-2">
                        Follow-up Questions
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {followUpQuestions.map((q) => (
                          <FollowUpTag
                            key={q.id}
                            label={q.label}
                            onClick={() => onFollowUpClick(q)}
                            disabled={isStreaming}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </QuestionAccordion>
          );
        })}
      </div>
    </div>
  );
}
