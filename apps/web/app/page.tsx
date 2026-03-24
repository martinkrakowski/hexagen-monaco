'use client';

import { useState, useMemo } from 'react';
import { useForm, useWatch, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { ResizableLayout } from '@/components/layout/ResizableLayout';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';

import { MonacoEditorWrapper } from '@/components/monaco/MonacoEditorWrapper';
import { GraphCanvasWrapper } from '@/components/canvas/GraphCanvasWrapper';
import { StepHeader } from '@/components/project-wizard/steps/StepHeader';

import {
  emptyFormValues,
  wizardSteps,
} from '@/components/project-wizard/config';
import {
  projectConfigSchema,
  type ProjectConfig,
} from '@hexagen/project-configuration';
import type {
  WizardData,
  BoundedContext,
  ExternalContext,
  PeerMapping,
} from '@hexagen/shared';

import { WizardStepRouter } from '@/components/project-wizard/WizardStepRouter';

export default function Home() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeContextId, setActiveContextId] = useState<string>('');
  const [activeMappingId, setActiveMappingId] = useState<string>('');

  const form = useForm<ProjectConfig>({
    resolver: zodResolver(projectConfigSchema),
    defaultValues: emptyFormValues,
    mode: 'all',
  });

  const watchedValues = useWatch({ control: form.control });

  const totalSteps = wizardSteps.length;
  const currentStepConfig = wizardSteps[currentStepIndex];

  const boundedContexts = (watchedValues.boundedContexts ||
    []) as BoundedContext[];
  const externalContexts = (watchedValues.externalContexts ||
    []) as ExternalContext[];
  const peerMappings = (watchedValues.peerMappings || []) as PeerMapping[];

  const canProceed =
    currentStepIndex === 1
      ? boundedContexts.length > 0 &&
        boundedContexts.every((c) => c.name?.trim() !== '')
      : true;

  const wizardData: WizardData = useMemo(
    () => ({
      boundedContexts,
      externalContexts,
      peerMappings,
      workspaceScope: watchedValues.governance?.workspaceName || '',
      withLlm: !!watchedValues.withLlm,
      withBlockchain: !!watchedValues.withBlockchain,
    }),
    [
      boundedContexts,
      externalContexts,
      peerMappings,
      watchedValues.governance?.workspaceName,
      watchedValues.withLlm,
      watchedValues.withBlockchain,
    ]
  );

  const initialManifest = useMemo(
    () => JSON.stringify(watchedValues, null, 2),
    [watchedValues]
  );

  const handleNext = async () => {
    const isValid =
      currentStepIndex !== 1 || (await form.trigger('boundedContexts'));

    if (isValid) {
      if (currentStepIndex === 2) setActiveMappingId('');
      setCurrentStepIndex((i) => Math.min(i + 1, totalSteps - 1));
    }
  };

  const handleBack = () => {
    if (currentStepIndex === 2) setActiveMappingId('');
    setCurrentStepIndex((i) => Math.max(i - 1, 0));
  };

  const handleGenerate = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1000);
  };

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background text-foreground">
      <Header />

      <main className="flex-1 flex flex-col overflow-hidden">
        <FormProvider {...form}>
          <ResizableLayout
            left={
              <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col bg-card">
                <StepHeader
                  currentStep={currentStepIndex + 1}
                  totalSteps={totalSteps}
                  title={currentStepConfig.title}
                  description={currentStepConfig.description}
                />

                <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
                  <WizardStepRouter
                    currentStepIndex={currentStepIndex}
                    totalSteps={totalSteps}
                    canProceed={canProceed}
                    isGenerating={loading}
                    activeContextId={activeContextId}
                    activeMappingId={activeMappingId}
                    onContextSelect={setActiveContextId}
                    onMappingSelect={setActiveMappingId}
                    onNext={handleNext}
                    onBack={handleBack}
                    onGenerate={handleGenerate}
                  />
                </CardContent>
              </Card>
            }
            middle={
              <Card className="h-full border-0 rounded-none overflow-hidden flex flex-col bg-card">
                <CardHeader className="border-b border-border shrink-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Architecture Preview
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden relative">
                  <GraphCanvasWrapper
                    projectId="demo"
                    wizardData={wizardData}
                  />
                </CardContent>
              </Card>
            }
            right={
              <Card className="h-full border-0 rounded-none flex flex-col bg-card">
                <CardHeader className="border-b border-border shrink-0">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Code Editor
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-hidden relative">
                  <MonacoEditorWrapper
                    initialBuffer={initialManifest}
                    sessionId="wizard-session-1"
                  />
                </CardContent>
              </Card>
            }
          />
        </FormProvider>
      </main>

      <Footer />
    </div>
  );
}
