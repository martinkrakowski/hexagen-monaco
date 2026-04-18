# Plan: Fix Follow-Up Context Loss + Preserve Conversation Thread

## Problem 1: Context/intent loss on follow-ups

**Root cause:** `askQuestion` and `askStepQuestion` in `use-governance-assistant.ts:68` call
`sendGovernanceMessage(prompt, GOVERNANCE_SYSTEM_PROMPT)` without passing the `history` parameter.
Every follow-up is a decontextualized single-turn generation. Small models (0.5B-3B) degrade
rapidly without conversational anchoring, producing CJK/JSON hallucinations.

## Problem 2: Chat history erased

**Root cause:** `GovernanceAssistantPanel.tsx:803-806` only renders `lastAssistantMessage` (the most
recent assistant message from the global `messages` array). When a new question is sent, the prior
answer vanishes.

---

## File 1: `apps/web/app/hooks/use-governance-assistant.ts`

### Full replacement content

```typescript
"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { WizardData } from "@hexagen/shared";
import type { LLMMessage } from "@hexagen/local-llm";
import { useLocalLLM } from "./use-local-llm";
import {
  type Violation,
  type AISuggestion,
  type PrebakedQuestion,
  type WizardStepId,
  VIOLATION_QUESTIONS,
  SUGGESTION_QUESTIONS,
  STEP_QUESTIONS,
  STEP_FOLLOW_UPS,
  VIOLATION_FOLLOW_UPS,
  SUGGESTION_FOLLOW_UPS,
  buildViolationPrompt,
  buildSuggestionPrompt,
  buildStepPrompt,
} from "@/lib/governance-question-templates";
import { serializeWizardContext } from "@/lib/wizard-assistant-context";
import { wizardSteps } from "@/components/project-wizard/config";

const GOVERNANCE_SYSTEM_PROMPT =
  "You are a Hexagonal Architecture expert assistant in HexaGen Monaco. Always respond in English. Answer questions concisely and helpfully. You have access to the user's project wizard context which describes their bounded contexts, governance settings, and peer mappings.";

/** Cap conversation history to last N messages (user+assistant pairs) to stay within small-model context budgets. */
const MAX_HISTORY_MESSAGES = 4;

export interface ConversationEntry {
  id: string;
  questionLabel: string;
  answer: string;
}

export type ActiveItem =
  | { type: "violation"; item: Violation }
  | { type: "suggestion"; item: AISuggestion };

export function useGovernanceAssistant(
  wizardData: WizardData,
  currentStepIndex: number,
) {
  const { messages, sendGovernanceMessage, engineState, isStreaming } =
    useLocalLLM();
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null);
  const [conversationThread, setConversationThread] = useState<
    ConversationEntry[]
  >([]);

  /**
   * Condensed LLM history for conversational context. Stores question labels
   * (not full prompts) as user messages to keep token count low. Capped to
   * MAX_HISTORY_MESSAGES to stay within small-model context windows.
   */
  const governanceHistoryRef = useRef<LLMMessage[]>([]);

  /** Tracks the question label for the currently streaming entry. */
  const pendingQuestionLabelRef = useRef<string | null>(null);

  /** Tracks whether we were streaming in the previous render (for edge detection). */
  const wasStreamingRef = useRef(false);

  const wizardContext = serializeWizardContext(wizardData);

  const currentStepId = useMemo<WizardStepId>(() => {
    const step = wizardSteps[currentStepIndex];
    return (step?.id as WizardStepId) ?? "workspace_governance";
  }, [currentStepIndex]);

  const stepQuestions = useMemo<PrebakedQuestion[]>(() => {
    return STEP_QUESTIONS[currentStepId] ?? [];
  }, [currentStepId]);

  const selectItem = useCallback((item: ActiveItem) => {
    setActiveItem(item);
  }, []);

  const askQuestion = useCallback(
    async (question: PrebakedQuestion) => {
      if (!activeItem) return;

      // Push a new thread entry for this question
      const entryId = `entry-${Date.now()}`;
      pendingQuestionLabelRef.current = question.label;
      setConversationThread((prev) => [
        ...prev,
        { id: entryId, questionLabel: question.label, answer: "" },
      ]);

      let prompt: string;
      if (activeItem.type === "violation") {
        prompt = buildViolationPrompt(question, activeItem.item, wizardContext);
      } else {
        prompt = buildSuggestionPrompt(
          question,
          activeItem.item,
          wizardContext,
        );
      }

      const history = governanceHistoryRef.current.slice(-MAX_HISTORY_MESSAGES);
      await sendGovernanceMessage(prompt, GOVERNANCE_SYSTEM_PROMPT, history);
    },
    [activeItem, wizardContext, sendGovernanceMessage],
  );

  const askStepQuestion = useCallback(
    async (question: PrebakedQuestion) => {
      // Push a new thread entry for this question
      const entryId = `entry-${Date.now()}`;
      pendingQuestionLabelRef.current = question.label;
      setConversationThread((prev) => [
        ...prev,
        { id: entryId, questionLabel: question.label, answer: "" },
      ]);

      const prompt = buildStepPrompt(question, currentStepId, wizardContext);
      const history = governanceHistoryRef.current.slice(-MAX_HISTORY_MESSAGES);
      await sendGovernanceMessage(prompt, GOVERNANCE_SYSTEM_PROMPT, history);
    },
    [currentStepId, wizardContext, sendGovernanceMessage],
  );

  // Finalize the last thread entry when streaming completes.
  // Uses edge detection (wasStreaming -> !isStreaming) to run exactly once.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      // Extract last assistant message content
      let lastAnswer = "";
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          lastAnswer = messages[i].content;
          break;
        }
      }

      if (lastAnswer) {
        // Finalize the thread entry
        setConversationThread((prev) => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          if (last.answer) return prev; // already finalized
          return [...prev.slice(0, -1), { ...last, answer: lastAnswer }];
        });

        // Append to governance history for future context
        const questionLabel = pendingQuestionLabelRef.current;
        if (questionLabel) {
          governanceHistoryRef.current.push(
            { role: "user", content: questionLabel },
            { role: "assistant", content: lastAnswer },
          );
          pendingQuestionLabelRef.current = null;
        }
      }
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, messages]);

  // Clear conversation thread and history when context changes
  useEffect(() => {
    setConversationThread([]);
    governanceHistoryRef.current = [];
    pendingQuestionLabelRef.current = null;
  }, [currentStepIndex, activeItem]);

  const getQuestions = useCallback((): PrebakedQuestion[] => {
    if (!activeItem) return [];
    return activeItem.type === "violation"
      ? VIOLATION_QUESTIONS
      : SUGGESTION_QUESTIONS;
  }, [activeItem]);

  const getFollowUpQuestions = useCallback((): PrebakedQuestion[] => {
    if (activeItem) {
      return activeItem.type === "violation"
        ? VIOLATION_FOLLOW_UPS
        : SUGGESTION_FOLLOW_UPS;
    }
    return STEP_FOLLOW_UPS[currentStepId] ?? [];
  }, [activeItem, currentStepId]);

  return {
    activeItem,
    selectItem,
    askQuestion,
    askStepQuestion,
    getQuestions,
    getFollowUpQuestions,
    conversationThread,
    stepQuestions,
    engineState,
    isStreaming,
  };
}
```

### Key changes:

1. Added `messages` to `useLocalLLM()` destructure
2. Added `ConversationEntry` type (exported for panel use)
3. Added `conversationThread` state, `governanceHistoryRef`, `pendingQuestionLabelRef`, `wasStreamingRef`
4. `askQuestion` and `askStepQuestion` now push thread entries and pass history
5. Edge-detected `useEffect` finalizes entries on stream complete and appends to history
6. Context-change effect clears thread + history
7. Return object exports `conversationThread` instead of nothing new

---

## File 2: `apps/web/app/components/agent/GovernanceAssistantPanel.tsx`

### Changes needed (described as diffs against current file):

#### 1. Add import for `ConversationEntry`

Change line 11 import:

```typescript
// OLD
import {
  type Violation,
  type AISuggestion,
  type PrebakedQuestion,
} from "@/lib/governance-question-templates";

// NEW
import {
  type Violation,
  type AISuggestion,
  type PrebakedQuestion,
} from "@/lib/governance-question-templates";
import type { ConversationEntry } from "@/hooks/use-governance-assistant";
```

#### 2. Update hook destructure (around line 459)

```typescript
// OLD
const {
  activeItem,
  selectItem,
  askQuestion,
  askStepQuestion,
  getQuestions,
  getFollowUpQuestions,
  stepQuestions,
  engineState,
  isStreaming,
} = useGovernanceAssistant(wizardData, currentStepIndex);

// NEW
const {
  activeItem,
  selectItem,
  askQuestion,
  askStepQuestion,
  getQuestions,
  getFollowUpQuestions,
  conversationThread,
  stepQuestions,
  engineState,
  isStreaming,
} = useGovernanceAssistant(wizardData, currentStepIndex);
```

#### 3. Replace `lastAssistantMessage` derivation (around line 508)

Keep the `lastAssistantMessage` useMemo — it's still needed for streaming display:

```typescript
// Keep this - needed for live streaming content
const lastAssistantMessage = useMemo(() => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      return messages[i].content;
    }
  }
  return "";
}, [messages]);
```

#### 4. Update the follow-up useEffect (around line 533)

The follow-up useEffect that currently watches `isStreaming` and `getFollowUpQuestions`:

```typescript
// OLD
useEffect(() => {
  if (isStreaming) return;
  setFollowUpQuestions(getFollowUpQuestions());
}, [isStreaming, getFollowUpQuestions]);

// NEW - only populate follow-ups when streaming completes AND there's at least one answer
useEffect(() => {
  if (isStreaming) return;
  const hasCompletedAnswer = conversationThread.some((e) => e.answer !== "");
  if (hasCompletedAnswer) {
    setFollowUpQuestions(getFollowUpQuestions());
  }
}, [isStreaming, getFollowUpQuestions, conversationThread]);
```

#### 5. Add `ThreadEntry` display component (add near other helper components, e.g. after AnswerArea)

```typescript
function ThreadEntry({
  entry,
  isCurrentlyStreaming,
  streamingContent,
}: {
  entry: ConversationEntry;
  isCurrentlyStreaming: boolean;
  streamingContent: string;
}) {
  const content = isCurrentlyStreaming ? streamingContent : entry.answer;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded flex items-center justify-center bg-primary/10">
          <MessageSquare size={10} className="text-primary" strokeWidth={2.5} />
        </div>
        <p className="text-[11px] font-medium text-primary">
          {entry.questionLabel}
        </p>
      </div>
      <AnswerArea content={content} />
    </div>
  );
}
```

#### 6. Replace the single AnswerArea rendering block (around line 803-806)

```typescript
// OLD
        {lastAssistantMessage && (
          <div className="mt-4">
            <AnswerArea content={lastAssistantMessage} />
          </div>
        )}

// NEW - render full conversation thread
        {conversationThread.length > 0 && (
          <div className="mt-4 space-y-4">
            {conversationThread.map((entry, i) => {
              const isLast = i === conversationThread.length - 1;
              const isCurrentlyStreaming =
                isStreaming && isLast && !entry.answer;
              return (
                <ThreadEntry
                  key={entry.id}
                  entry={entry}
                  isCurrentlyStreaming={isCurrentlyStreaming}
                  streamingContent={lastAssistantMessage}
                />
              );
            })}
          </div>
        )}
```

#### 7. Follow-up questions section is unchanged (already correct)

The follow-up section renders after the thread, which is correct.

---

## Design Decisions

| Decision                                      | Rationale                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Question labels in history (not full prompts) | Full prompts include ~500 tokens of wizard context each. 2-3 turns would overflow a 2K context window. Labels are 5-15 tokens. |
| Cap history at 4 messages (2 turns)           | 0.5B-3B models have 2K-4K context windows. The current prompt + system prompt already consume ~600 tokens.                     |
| `governanceHistoryRef` as ref, not state      | Only used for LLM calls, not rendering. No need to trigger re-renders.                                                         |
| Edge detection via `wasStreamingRef`          | Ensures finalization runs exactly once per stream completion, not on every `messages` update during streaming.                 |
| Thread in hook, not panel                     | Hook knows when questions are asked and can correlate labels with responses. Panel just renders.                               |

## Verification

After implementing both files:

```bash
yarn lint && yarn typecheck && yarn build
```
