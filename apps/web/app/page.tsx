'use client';

import { useState } from 'react';
import type { FileTreeNode } from '@hexagen/project-configuration';
import { ResizableLayout } from '@/components/layout/ResizableLayout';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import {
  projectConfigSchema,
  emptyFormValues,
  wizardSteps,
  projectAddons,
} from '@/components/project-wizard/config';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

type ProjectConfig = z.infer<typeof projectConfigSchema>;

export default function Home() {
  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: emptyFormValues,
  });

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentStep = wizardSteps[step];
  const isLastStep = step === wizardSteps.length - 1;
  const isFirstStep = step === 0;

  const handleNext = async () => {
    const isValid = await form.trigger(currentStep.fields as any[]);
    if (!isValid) return;

    if (isLastStep) {
      await handleGenerate();
    } else {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (!isFirstStep) setStep(step - 1);
  };

  const handleCancel = () => {
    form.reset(emptyFormValues);
    setStep(0);
    setTree(null);
    setError(null);
  };

  const handleReset = () => {
    form.reset(emptyFormValues);
    setStep(0);
    setTree(null);
    setError(null);
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setTree(null);

    const values = form.getValues();

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setTree(data.tree);
      setStep(wizardSteps.length);
    } catch (err) {
      setError((err as Error).message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!tree) return;

    try {
      setLoading(true);
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tree),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.error || `Download failed (HTTP ${res.status})`
        );
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tree.name || 'project'}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message || 'Download error');
    } finally {
      setLoading(false);
    }
  };

  const LeftPane = () => (
    <Card className="h-full border-0 rounded-none overflow-hidden">
      <CardHeader>
        <CardTitle>Wizard</CardTitle>
      </CardHeader>
      <CardContent className="p-6 overflow-y-auto h-[calc(100%-4rem)]">
        {/* Step indicator */}
        <div className="flex justify-between mb-6">
          {wizardSteps.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                step >= i
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {i + 1}
            </div>
          ))}
        </div>

        <h2 className="text-lg font-semibold mb-4">{currentStep.title}</h2>
        <p className="text-sm text-muted-foreground mb-6">
          {currentStep.description}
        </p>

        {/* Project Type Step */}
        {currentStep.id === 'project_type' && (
          <div className="space-y-6">
            {projectAddons.map((addon) => (
              <div key={addon.id} className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id={addon.id}
                  checked={form.watch(addon.id)}
                  onChange={(e) => form.setValue(addon.id, e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <label htmlFor={addon.id} className="font-medium">
                    {addon.title}
                  </label>
                  <p className="text-sm text-muted-foreground">
                    {addon.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Workspace Step */}
        {currentStep.id === 'workspace' && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium block mb-2">
                Project Name
              </label>
              <Input {...form.register('rootName')} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">
                Workspace Scope
              </label>
              <Input {...form.register('workspaceScope')} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">
                Context Name
              </label>
              <Input {...form.register('contextName')} />
            </div>
          </div>
        )}

        {/* Core Step */}
        {currentStep.id === 'core' && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium block mb-2">Entities</label>
              <Textarea
                {...form.register('entities')}
                rows={3}
                placeholder="One per line"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">
                Use Cases
              </label>
              <Textarea
                {...form.register('useCases')}
                rows={3}
                placeholder="One per line"
              />
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-4 mt-8">
          {!isFirstStep && (
            <PrimaryButton
              variant="outline"
              onClick={handleBack}
              className="flex-1"
            >
              Back
            </PrimaryButton>
          )}
          <PrimaryButton
            onClick={handleNext}
            disabled={loading}
            className="flex-1"
          >
            {loading
              ? 'Generating...'
              : isLastStep
                ? 'Generate Project'
                : 'Next'}
          </PrimaryButton>
        </div>

        <div className="flex gap-4 mt-4">
          <PrimaryButton
            variant="ghost"
            onClick={handleCancel}
            className="flex-1"
          >
            Cancel
          </PrimaryButton>
          <PrimaryButton
            variant="ghost"
            onClick={handleReset}
            className="flex-1"
          >
            Reset
          </PrimaryButton>
        </div>
      </CardContent>
    </Card>
  );

  const MiddlePane = () => (
    <Card className="h-full border-0 rounded-none overflow-hidden">
      <CardHeader>
        <CardTitle>Generated Tree Preview</CardTitle>
      </CardHeader>
      <CardContent className="p-6 overflow-y-auto h-[calc(100%-4rem)]">
        {tree ? (
          <pre className="bg-muted p-4 rounded-md overflow-auto text-sm font-mono max-h-[calc(100vh-120px)]">
            {JSON.stringify(tree, null, 2)}
          </pre>
        ) : (
          <p className="text-muted-foreground">
            Generate a project to see the tree here.
          </p>
        )}
      </CardContent>
    </Card>
  );

  const RightPane = () => (
    <Card className="h-full border-0 rounded-none overflow-hidden">
      <CardHeader>
        <CardTitle>Monaco AI Assistant</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <p className="text-muted-foreground">
          Grok-powered chat for architecture reviews, suggestions, and code
          generation coming soon.
        </p>
      </CardContent>
    </Card>
  );

  return (
    <ResizableLayout
      left={<LeftPane />}
      middle={<MiddlePane />}
      right={<RightPane />}
    />
  );
}
