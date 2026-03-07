'use client';

import { useState, useCallback } from 'react';
// import type { FileTreeNode } from '@hexagen/project-generation';
import { ResizableLayout } from '@/components/layout/ResizableLayout';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { cn } from '@/lib/utils';
import { MonacoEditorWrapper } from '@/components/monaco/MonacoEditorWrapper';

import {
  emptyFormValues,
  wizardSteps,
  projectAddons,
} from '@/components/project-wizard/config';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  projectConfigSchema,
  type ProjectConfig,
} from '@hexagen/project-configuration';

// Intent Bus type
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
      // payload: FileTreeNode;
      metadata: { confidence: number };
    };

// Type for addon items (from project-wizard/config)
type ProjectAddon = {
  id: keyof ProjectConfig;
  title: string;
  description?: string;
};

export default function Home() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === wizardSteps.length - 1;

  const defaultProjectValues: Partial<ProjectConfig> = {
    ...emptyFormValues,
    workspaceScope: '@hexagen',
    contextName: 'core',
    messagingAdapter: 'BullMQ',
    telemetryProvider: 'OpenTelemetry',
    uiFramework: 'Next.js',
    apiFramework: 'Fastify',
    persistenceAdapter: undefined,
    entities: [],
    useCases: [],
    externalApiPorts: [],
    llmProviders: [],
    blockchainNetworks: [],
  };

  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: defaultProjectValues,
    mode: 'all',
  });

  const watchedValues = useWatch({
    control: form.control,
  });

  const currentStep = wizardSteps[currentStepIndex];

  const canProceed =
    currentStepIndex === 0
      ? !!watchedValues.rootName?.trim() && !!watchedValues.contextName?.trim()
      : true;

  const dispatchIntent = useCallback(
    async (intent: Intent) => {
      switch (intent.type) {
        case 'WIZARD_NEXT': {
          const fieldsToValidate: (keyof ProjectConfig)[] =
            currentStepIndex === 0 ? ['rootName', 'contextName'] : [];
          const isValid = await form.trigger(fieldsToValidate);
          if (isValid) {
            setCurrentStepIndex((i) => Math.min(i + 1, wizardSteps.length - 1));
          }
          break;
        }
        case 'WIZARD_BACK':
          setCurrentStepIndex((i) => Math.max(i - 1, 0));
          break;
        case 'GENERATE_PROJECT':
          setLoading(true);
          setTimeout(() => {
            setLoading(false);
            // TODO: real generation via ProjectGeneratorPort
          }, 1000);
          break;
        case 'RESET':
          form.reset(defaultProjectValues);
          setCurrentStepIndex(0);
          break;
        default:
          // Placeholder for future intents
          break;
      }
    },
    [form, currentStepIndex]
  );

  const initialManifest = JSON.stringify(watchedValues, null, 2);
  const sessionId = 'wizard-session-1'; // Dummy – persist later

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <Header />
      <main className="flex-1 flex flex-col overflow-hidden">
        <ResizableLayout
          left={
            <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col">
              <CardHeader>
                <CardTitle>HexaGen Project Wizard</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-8 overflow-y-auto">
                {/* Debug */}
                <div className="mb-4 text-[10px] font-mono bg-black text-green-400 p-2 rounded border border-green-900/30">
                  STEP: {currentStepIndex + 1} (ID: {currentStep.id}) |
                  CAN_PROCEED: {String(canProceed)}
                </div>

                <div className="flex gap-2 mb-8">
                  {wizardSteps.map((_, i) => (
                    <div
                      key={i}
                      className={cn(
                        'w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-medium transition-all',
                        i === currentStepIndex
                          ? 'bg-primary text-primary-foreground border-primary scale-110'
                          : i < currentStepIndex
                            ? 'bg-primary/20 text-primary border-primary'
                            : 'bg-muted text-muted-foreground border-muted'
                      )}
                    >
                      {i + 1}
                    </div>
                  ))}
                </div>

                <h2 className="text-2xl font-semibold mb-2">
                  {currentStep.title}
                </h2>
                <p className="text-muted-foreground mb-8 text-sm">
                  {currentStep.description}
                </p>

                <div className="space-y-8 flex-1">
                  {currentStepIndex === 0 && (
                    <div className="space-y-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Root Project Name *
                        </label>
                        <input
                          {...form.register('rootName')}
                          className="w-full px-4 py-2 border rounded-md"
                          placeholder="my-hexagen-app"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Context Name *
                        </label>
                        <input
                          {...form.register('contextName')}
                          className="w-full px-4 py-2 border rounded-md"
                          placeholder="billing-context"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-3">
                          Project Type Selection
                        </label>
                        {projectAddons.map((addon: ProjectAddon) => (
                          <div
                            key={addon.id}
                            className="flex items-start gap-3 mb-4"
                          >
                            <input
                              type="checkbox"
                              checked={!!watchedValues[addon.id]}
                              onChange={(e) =>
                                form.setValue(addon.id, e.target.checked, {
                                  shouldValidate: true,
                                  shouldDirty: true,
                                })
                              }
                              className="mt-1.5 h-4 w-4 accent-primary"
                            />
                            <label className="font-medium cursor-pointer text-sm">
                              {addon.title}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentStepIndex === 1 && (
                    <div className="space-y-6">
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          LLM Providers (comma-separated)
                        </label>
                        <input
                          {...form.register('llmProviders')}
                          className="w-full px-4 py-2 border rounded-md"
                          placeholder="OpenAI,Anthropic,Grok"
                        />
                      </div>
                    </div>
                  )}

                  {currentStepIndex === 2 && (
                    <div className="space-y-6">
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          Blockchain Networks (comma-separated)
                        </label>
                        <input
                          {...form.register('blockchainNetworks')}
                          className="w-full px-4 py-2 border rounded-md"
                          placeholder="Ethereum,Polygon,Solana"
                        />
                      </div>
                    </div>
                  )}

                  {currentStepIndex === 3 && (
                    <div className="space-y-6">
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          Workspace Scope
                        </label>
                        <input
                          {...form.register('workspaceScope')}
                          className="w-full px-4 py-2 border rounded-md"
                          placeholder="@hexagen"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          Context Name
                        </label>
                        <input
                          {...form.register('contextName')}
                          className="w-full px-4 py-2 border rounded-md"
                          placeholder="billing-context"
                        />
                      </div>
                    </div>
                  )}

                  {currentStepIndex === 4 && (
                    <div className="space-y-6">
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          API Framework
                        </label>
                        <select
                          {...form.register('apiFramework')}
                          className="w-full px-4 py-2 border rounded-md"
                        >
                          <option value="Fastify">Fastify</option>
                          <option value="Express">Express</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          UI Framework
                        </label>
                        <select
                          {...form.register('uiFramework')}
                          className="w-full px-4 py-2 border rounded-md"
                        >
                          <option value="Next.js">Next.js</option>
                          <option value="React">React</option>
                          <option value="Vue.js">Vue.js</option>
                          <option value="Angular">Angular</option>
                          <option value="React Router 7">React Router 7</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {currentStepIndex === 5 && (
                    <div className="space-y-6">
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          Persistence Adapter
                        </label>
                        <select
                          {...form.register('persistenceAdapter')}
                          className="w-full px-4 py-2 border rounded-md"
                        >
                          <option value="Prisma">Prisma</option>
                          <option value="TypeORM">TypeORM</option>
                          <option value="Mongoose">Mongoose</option>
                          <option value="Drizzle">Drizzle</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          Messaging Adapter
                        </label>
                        <select
                          {...form.register('messagingAdapter')}
                          className="w-full px-4 py-2 border rounded-md"
                        >
                          <option value="BullMQ">BullMQ</option>
                          <option value="Kafka">Kafka</option>
                          <option value="RabbitMQ">RabbitMQ</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {currentStepIndex === 6 && (
                    <div className="space-y-6">
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          Entities (comma-separated)
                        </label>
                        <input
                          {...form.register('entities')}
                          className="w-full px-4 py-2 border rounded-md"
                          placeholder="User,Order,Product"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground block mb-1.5">
                          Use Cases (comma-separated)
                        </label>
                        <input
                          {...form.register('useCases')}
                          className="w-full px-4 py-2 border rounded-md"
                          placeholder="RegisterUser,PlaceOrder"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-auto flex gap-3 pt-6 border-t">
                  {!isFirstStep && (
                    <PrimaryButton
                      variant="outline"
                      className="flex-1"
                      onClick={() =>
                        dispatchIntent({
                          type: 'WIZARD_BACK',
                          source: 'user',
                          payload: null,
                          metadata: { confidence: 1 },
                        })
                      }
                    >
                      Back
                    </PrimaryButton>
                  )}
                  <PrimaryButton
                    className="flex-1"
                    disabled={!canProceed || loading}
                    onClick={() =>
                      dispatchIntent({
                        type: isLastStep ? 'GENERATE_PROJECT' : 'WIZARD_NEXT',
                        source: 'user',
                        payload: form.getValues(),
                        metadata: { confidence: 1 },
                      })
                    }
                  >
                    {isLastStep ? 'Generate' : 'Next'}
                  </PrimaryButton>
                </div>
              </CardContent>
            </Card>
          }
          middle={
            <Card className="h-full border-0 rounded-none bg-muted/20">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  Live Manifest Preview
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <pre className="text-[11px] font-mono bg-background p-4 rounded-md border shadow-sm">
                  {JSON.stringify(watchedValues, null, 2)}
                </pre>
              </CardContent>
            </Card>
          }
          right={
            <Card className="h-full border-0 rounded-none">
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">
                  Grok AI Architect
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 overflow-hidden">
                <MonacoEditorWrapper
                  initialBuffer={initialManifest}
                  sessionId={sessionId}
                />
              </CardContent>
            </Card>
          }
        />
      </main>
      <Footer />
    </div>
  );
}
