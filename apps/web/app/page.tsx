'use client';

import { useState } from 'react';
import type { FileTreeNode } from '@hexagen/project-generation';
import { ResizableLayout } from '@/components/layout/ResizableLayout';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import {
  emptyFormValues,
  wizardSteps,
  projectAddons,
  llmProviderOptions,
  blockchainNetworkOptions,
  persistenceAdapterOptions,
  messagingAdapterOptions,
  telemetryProviderOptions,
  apiFrameworkOptions,
  uiFrameworkOptions,
} from '@/components/project-wizard/config';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { cn } from '@/lib/utils';
import {
  projectConfigSchema,
  type ProjectConfig,
} from '@hexagen/project-configuration';

export default function Home() {
  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: emptyFormValues,
  });

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerated, setIsGenerated] = useState(false);

  const currentStep = wizardSteps[step] ?? wizardSteps[wizardSteps.length - 1];
  const isLastStep = step === wizardSteps.length - 1;
  const isFirstStep = step === 0;

  const handleNext = async () => {
    if (step === 0) {
      let nextStep = 1;
      while (nextStep < wizardSteps.length) {
        const nextStepConfig = wizardSteps[nextStep];
        if (nextStepConfig.condition && !nextStepConfig.condition(form)) {
          nextStep++;
        } else {
          break;
        }
      }
      setStep(nextStep);
      return;
    }

    const isValid = await form.trigger();
    if (!isValid) return;

    let nextStep = step + 1;
    while (nextStep < wizardSteps.length) {
      const nextStepConfig = wizardSteps[nextStep];
      if (nextStepConfig.condition && !nextStepConfig.condition(form)) {
        nextStep++;
      } else {
        break;
      }
    }
    setStep(nextStep);
  };

  const handleBack = () => {
    if (!isFirstStep) setStep(step - 1);
  };

  const handleCancel = () => {
    form.reset(emptyFormValues);
    setStep(0);
    setTree(null);
    setError(null);
    setIsGenerated(false);
  };

  const handleReset = () => {
    form.reset(emptyFormValues);
    setStep(0);
    setTree(null);
    setError(null);
    setIsGenerated(false);
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);

    const values = form.getValues();

    const transformed = {
      ...values,
      entities:
        typeof values.entities === 'string'
          ? values.entities
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
          : values.entities,
      useCases:
        typeof values.useCases === 'string'
          ? values.useCases
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
          : values.useCases,
    };

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transformed),
      });

      if (!res.ok) throw new Error('Generation failed');

      const data = await res.json();
      setTree(data.tree ?? data);
      setIsGenerated(true);
      setStep(wizardSteps.length - 1);
    } catch (err) {
      setError((err as Error).message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = () => {
    setTree(null);
    setIsGenerated(false);
  };

  const handleDownload = async () => {
    if (!tree) return;

    setLoading(true);
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tree),
      });

      if (!res.ok) throw new Error('Download failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tree.name || form.getValues().rootName || 'hexagen-project'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Download failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Left Pane (Wizard) ──
  const LeftPane = () => (
    <Card className="h-full border-0 rounded-none overflow-hidden">
      <CardHeader>
        <CardTitle>Project Wizard</CardTitle>
      </CardHeader>
      <CardContent className="p-6 overflow-y-auto h-[calc(100%-4rem)]">
        {/* Step progress */}
        <div className="flex justify-between mb-6 px-2">
          {wizardSteps.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border',
                step >= i
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-muted'
              )}
            >
              {i + 1}
            </div>
          ))}
        </div>

        <h2 className="text-lg font-semibold mb-2">{currentStep.title}</h2>
        <p className="text-sm text-muted-foreground mb-6">
          {currentStep.description}
        </p>

        {/* Project Type Step */}
        {currentStep.id === 'project_type' && (
          <div className="space-y-6">
            <div className="flex items-start space-x-3 opacity-60 pointer-events-none">
              <input type="checkbox" checked disabled className="mt-1.5" />
              <div>
                <label className="font-medium block">
                  Standard Hexagonal Monorepo
                </label>
                <p className="text-sm text-muted-foreground mt-1">
                  Base TypeScript monorepo with Yarn workspaces, Turborepo,
                  strict hexagonal architecture.
                </p>
              </div>
            </div>

            {projectAddons.map((addon) => (
              <div key={addon.id} className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id={addon.id}
                  checked={form.watch(addon.id as keyof ProjectConfig)}
                  onChange={(e) =>
                    form.setValue(addon.id as any, e.target.checked)
                  }
                  className="mt-1.5 h-4 w-4"
                />
                <div>
                  <label htmlFor={addon.id} className="font-medium block">
                    {addon.title}
                  </label>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {addon.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* LLM Config Step */}
        {currentStep.id === 'llm_config' && form.watch('withLlm') && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium block mb-2">
                LLM Providers
              </label>
              <select
                multiple
                className="w-full border rounded-md p-2 min-h-[120px]"
                {...form.register('llmProviders')}
              >
                {llmProviderOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Blockchain Config Step */}
        {currentStep.id === 'blockchain_config' &&
          form.watch('withBlockchain') && (
            <div className="space-y-6">
              <div>
                <label className="text-sm font-medium block mb-2">
                  Blockchain Networks
                </label>
                <select
                  multiple
                  className="w-full border rounded-md p-2 min-h-[120px]"
                  {...form.register('blockchainNetworks')}
                >
                  {blockchainNetworkOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

        {/* Workspace Step */}
        {currentStep.id === 'workspace' && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium block mb-2">
                Project Name (root folder)
              </label>
              <Input
                {...form.register('rootName')}
                placeholder="my-awesome-project"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">
                Workspace Scope
              </label>
              <Input
                {...form.register('workspaceScope')}
                placeholder="@myorg"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">
                Main Context Name
              </label>
              <Input {...form.register('contextName')} placeholder="core" />
            </div>
          </div>
        )}

        {/* Drivers Step */}
        {currentStep.id === 'drivers' && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium block mb-2">
                API Framework
              </label>
              <select
                className="w-full border rounded-md p-2"
                {...form.register('apiFramework')}
              >
                {apiFrameworkOptions.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">
                UI Framework
              </label>
              <select
                className="w-full border rounded-md p-2"
                {...form.register('uiFramework')}
              >
                {uiFrameworkOptions.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Adapters Step */}
        {currentStep.id === 'adapters' && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium block mb-2">
                Persistence
              </label>
              <select
                className="w-full border rounded-md p-2"
                {...form.register('persistenceAdapter')}
              >
                {persistenceAdapterOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">
                Messaging
              </label>
              <select
                className="w-full border rounded-md p-2"
                {...form.register('messagingAdapter')}
              >
                {messagingAdapterOptions.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">
                Telemetry
              </label>
              <select
                className="w-full border rounded-md p-2"
                {...form.register('telemetryProvider')}
              >
                {telemetryProviderOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Core Step */}
        {currentStep.id === 'core' && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium block mb-2">
                Entities (one per line)
              </label>
              <Textarea
                {...form.register('entities')}
                placeholder="User\nOrder\nProduct"
                rows={4}
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">
                Use Cases (one per line)
              </label>
              <Textarea
                {...form.register('useCases')}
                placeholder="CreateUser\nPlaceOrder\nGetProductDetails"
                rows={4}
              />
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-10">
          {!isFirstStep && (
            <PrimaryButton
              variant="outline"
              onClick={handleBack}
              className="flex-1"
              disabled={isGenerated}
            >
              Back
            </PrimaryButton>
          )}
          <PrimaryButton
            onClick={
              isGenerated
                ? handleRegenerate
                : isLastStep
                  ? handleGenerate
                  : handleNext
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
            onClick={handleCancel}
            className="flex-1 text-sm"
          >
            Cancel
          </PrimaryButton>
          <PrimaryButton
            variant="ghost"
            onClick={handleReset}
            className="flex-1 text-sm"
          >
            New Project
          </PrimaryButton>
          {isGenerated && tree && (
            <PrimaryButton
              onClick={handleDownload}
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

  // ── Middle Pane (Tree Preview) ──
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

  // ── Right Pane (AI Stub) ──
  const RightPane = () => (
    <Card className="h-full border-0 rounded-none overflow-hidden">
      <CardHeader>
        <CardTitle>Grok AI Architect</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <p className="text-muted-foreground leading-relaxed">
          HexaGen Monaco's built-in Grok-powered assistant.
          <br />
          <br />
          Coming features:
        </p>
        <ul className="mt-4 space-y-2 text-sm text-muted-foreground list-disc pl-5">
          <li>Architecture reviews & suggestions</li>
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
