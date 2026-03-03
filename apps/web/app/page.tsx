'use client';

import { useState, useCallback, useMemo } from 'react';
import type { FileTreeNode } from '@hexagen/project-generation';
import { ResizableLayout } from '@/components/layout/ResizableLayout';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { cn } from '@/lib/utils'; // ← FIXED: Added (ShadCN utility)

import {
  emptyFormValues,
  wizardSteps,
  projectAddons,
} from '@/components/project-wizard/config';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  projectConfigSchema,
  type ProjectConfig,
} from '@hexagen/project-configuration';

// ── Intent Bus (A2UI Core) ──
type Intent =
  | {
      type: 'WIZARD_NEXT';
      source: 'user' | 'agent';
      payload: Partial<ProjectConfig>;
      metadata: { confidence: number };
    }
  | {
      type: 'WIZARD_BACK';
      source: 'user' | 'agent';
      payload: null;
      metadata: { confidence: number };
    }
  | {
      type: 'GENERATE_PROJECT';
      source: 'user' | 'agent';
      payload: ProjectConfig;
      metadata: { confidence: number };
    }
  | {
      type: 'REGENERATE_PROJECT';
      source: 'user' | 'agent';
      payload: null;
      metadata: { confidence: number };
    }
  | {
      type: 'CANCEL';
      source: 'user' | 'agent';
      payload: null;
      metadata: { confidence: number };
    }
  | {
      type: 'RESET';
      source: 'user' | 'agent';
      payload: null;
      metadata: { confidence: number };
    }
  | {
      type: 'DOWNLOAD';
      source: 'user' | 'agent';
      payload: FileTreeNode;
      metadata: { confidence: number };
    };

export default function Home() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isGenerated, setIsGenerated] = useState(false);

  // Projection layer (pure, testable)
  const currentStep = useMemo(
    () => wizardSteps[currentStepIndex],
    [currentStepIndex]
  );
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === wizardSteps.length - 1;

  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: emptyFormValues,
    mode: 'onChange',
  });

  // Intent dispatcher (single source of truth for all mutations)
  const dispatchIntent = useCallback(
    (intent: Intent) => {
      // Telemetry port hook would go here (port-driven)
      console.info('[Intent]', intent); // placeholder for observability port

      if (intent.metadata.confidence < 0.8 && intent.source === 'agent') {
        // Confidence gating policy
        if (!confirm('Agent confidence low. Proceed anyway?')) return;
      }

      switch (intent.type) {
        case 'WIZARD_NEXT':
          if (form.trigger()) {
            setCurrentStepIndex((i) => Math.min(i + 1, wizardSteps.length - 1));
          }
          break;
        case 'WIZARD_BACK':
          setCurrentStepIndex((i) => Math.max(i - 1, 0));
          break;
        case 'GENERATE_PROJECT':
          setLoading(true);
          setError(null);
          // Call to ProjectGeneratorPort would go here
          setTimeout(() => {
            setTree({ name: 'generated-project', children: [] }); // stub
            setIsGenerated(true);
            setLoading(false);
          }, 800);
          break;
        case 'REGENERATE_PROJECT':
          setIsGenerated(false);
          setTree(null);
          dispatchIntent({
            type: 'GENERATE_PROJECT',
            source: intent.source,
            payload: form.getValues(),
            metadata: { confidence: 1 },
          });
          break;
        case 'CANCEL':
        case 'RESET':
          form.reset(emptyFormValues);
          setCurrentStepIndex(0);
          setTree(null);
          setIsGenerated(false);
          setError(null);
          break;
        case 'DOWNLOAD':
          // DownloadProviderPort would be called here
          alert('Download ZIP stub (port-driven)');
          break;
      }
    },
    [form]
  );

  // ── Left Pane (Wizard) ──
  const LeftPane = () => (
    <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col">
      <CardHeader>
        <CardTitle>HexaGen Project Wizard</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-8 overflow-y-auto">
        {/* Step indicator */}
        <div className="flex gap-2 mb-8">
          {wizardSteps.map((_, i) => (
            <div
              key={i}
              className={cn(
                'w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-medium transition-colors',
                i === currentStepIndex
                  ? 'bg-primary text-primary-foreground border-primary'
                  : i < currentStepIndex
                    ? 'bg-primary/10 text-primary border-primary'
                    : 'bg-muted text-muted-foreground border-muted'
              )}
            >
              {i + 1}
            </div>
          ))}
        </div>

        <h2 className="text-2xl font-semibold mb-2">{currentStep.title}</h2>
        <p className="text-muted-foreground mb-8">{currentStep.description}</p>

        {/* Form fields projected from config (Step 2 will expand) */}
        {currentStep.id === 'basics' && (
          <div className="space-y-6">
            {/* Addon checkboxes projected */}
            {projectAddons.map((addon) => (
              <div key={addon.id} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={
                    form.watch(addon.id as keyof ProjectConfig) as boolean
                  }
                  onChange={(e) =>
                    form.setValue(
                      addon.id as keyof ProjectConfig,
                      e.target.checked as any
                    )
                  }
                  className="mt-1.5 h-4 w-4"
                />
                <div>
                  <div className="font-medium">{addon.label}</div>
                  <div className="text-sm text-muted-foreground">
                    {addon.description}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Navigation */}
        <div className="mt-auto flex gap-3 pt-10">
          {!isFirstStep && (
            <PrimaryButton
              variant="outline"
              onClick={() =>
                dispatchIntent({
                  type: 'WIZARD_BACK',
                  source: 'user',
                  payload: null,
                  metadata: { confidence: 1 },
                })
              }
              className="flex-1"
              disabled={isGenerated}
            >
              Back
            </PrimaryButton>
          )}
          <PrimaryButton
            onClick={() =>
              isGenerated
                ? dispatchIntent({
                    type: 'REGENERATE_PROJECT',
                    source: 'user',
                    payload: null,
                    metadata: { confidence: 1 },
                  })
                : isLastStep
                  ? dispatchIntent({
                      type: 'GENERATE_PROJECT',
                      source: 'user',
                      payload: form.getValues(),
                      metadata: { confidence: 1 },
                    })
                  : dispatchIntent({
                      type: 'WIZARD_NEXT',
                      source: 'user',
                      payload: {},
                      metadata: { confidence: 1 },
                    })
            }
            disabled={loading || form.formState.isSubmitting}
            className="flex-1"
          >
            {loading
              ? 'Generating...'
              : isGenerated
                ? 'Regenerate Project'
                : isLastStep
                  ? 'Generate Project'
                  : 'Next'}
          </PrimaryButton>
        </div>

        <div className="flex gap-3 mt-4">
          <PrimaryButton
            variant="ghost"
            onClick={() =>
              dispatchIntent({
                type: 'CANCEL',
                source: 'user',
                payload: null,
                metadata: { confidence: 1 },
              })
            }
            className="flex-1 text-sm"
          >
            Cancel
          </PrimaryButton>
          <PrimaryButton
            variant="ghost"
            onClick={() =>
              dispatchIntent({
                type: 'RESET',
                source: 'user',
                payload: null,
                metadata: { confidence: 1 },
              })
            }
            className="flex-1 text-sm"
          >
            New Project
          </PrimaryButton>
          {isGenerated && tree && (
            <PrimaryButton
              onClick={() =>
                dispatchIntent({
                  type: 'DOWNLOAD',
                  source: 'user',
                  payload: tree,
                  metadata: { confidence: 1 },
                })
              }
              disabled={loading}
              className="flex-1"
            >
              Download ZIP
            </PrimaryButton>
          )}
        </div>

        {error && (
          <p className="mt-6 text-sm text-destructive text-center">{error}</p>
        )}
      </CardContent>
    </Card>
  );

  // ── Middle & Right Panes (unchanged projection style) ──
  const MiddlePane = () => (
    <Card className="h-full border-0 rounded-none overflow-hidden">
      <CardHeader>
        <CardTitle>Project Structure Preview</CardTitle>
      </CardHeader>
      <CardContent className="p-6 overflow-y-auto h-[calc(100%-4rem)]">
        {tree ? (
          <pre className="bg-muted/50 p-5 rounded-lg text-sm font-mono overflow-auto max-h-full whitespace-pre-wrap">
            {JSON.stringify(tree, null, 2)}
          </pre>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <p>Generate your project to see the file tree here.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const RightPane = () => (
    <Card className="h-full border-0 rounded-none overflow-hidden">
      <CardHeader>
        <CardTitle>Grok AI Architect</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <p className="text-muted-foreground leading-relaxed">
          HexaGen Monaco&apos;s built-in Grok-powered assistant.
          <br />
          <br />
          Coming features:
        </p>
        <ul className="mt-4 space-y-2 text-sm text-muted-foreground list-disc pl-5">
          <li>Architecture reviews &amp; suggestions</li>
          <li>Intent-based code patches via Monaco</li>
          <li>DDD entity / use-case modeling help</li>
          <li>Real-time hexagonal compliance checks</li>
        </ul>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <Header />
      <main className="flex-1 flex flex-col overflow-hidden">
        <ResizableLayout
          left={<LeftPane />}
          middle={<MiddlePane />}
          right={<RightPane />}
        />
      </main>
      <Footer />
    </div>
  );
}
