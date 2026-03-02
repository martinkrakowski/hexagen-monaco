'use client';

import { useState } from 'react';
import type { FileTreeNode } from '@hexagen/project-configuration';
import { ResizableLayout } from '@/components/layout/ResizableLayout';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

export default function Home() {
  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState('MyHexaGenProject');
  const [description, setDescription] = useState('AI-powered monorepo');
  const [boundedContexts, setBoundedContexts] = useState<string[]>([
    'User',
    'Order',
    'Payment',
  ]);
  const [newContext, setNewContext] = useState('');

  const [loading, setLoading] = useState(false);
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAddContext = () => {
    if (newContext.trim()) {
      setBoundedContexts([...boundedContexts, newContext.trim()]);
      setNewContext('');
    }
  };

  const handleRemoveContext = (index: number) => {
    setBoundedContexts(boundedContexts.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setTree(null);

    const spec = {
      id: 'test-' + Date.now(),
      name: projectName,
      description,
      boundedContexts,
      version: '1.0.0',
    };

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setTree(data.tree);
      setStep(4);
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
      {error && (
        <div className="m-4 p-4 bg-destructive text-destructive-foreground rounded-md">
          <p className="font-medium">Error: {error}</p>
        </div>
      )}
      <CardHeader>
        <CardTitle>Wizard</CardTitle>
      </CardHeader>
      <CardContent className="p-6 overflow-y-auto h-[calc(100%-4rem)]">
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium block mb-2">
                Project Name
              </label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-2">
                Description
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>
            <PrimaryButton onClick={() => setStep(2)} className="w-full">
              Next: Bounded Contexts
            </PrimaryButton>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium block mb-2">
                Bounded Contexts
              </label>
              <div className="flex gap-2 mb-4">
                <Input
                  value={newContext}
                  onChange={(e) => setNewContext(e.target.value)}
                  placeholder="Add context..."
                />
                <PrimaryButton onClick={handleAddContext}>Add</PrimaryButton>
              </div>
              <div className="space-y-2">
                {boundedContexts.map((ctx, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between bg-muted p-3 rounded-md"
                  >
                    <span>{ctx}</span>
                    <PrimaryButton
                      variant="destructive"
                      size="sm"
                      onClick={() => handleRemoveContext(i)}
                    >
                      Remove
                    </PrimaryButton>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-4">
              <PrimaryButton onClick={() => setStep(1)} variant="outline">
                Back
              </PrimaryButton>
              <PrimaryButton onClick={() => setStep(3)} className="flex-1">
                Next: Tech Stack
              </PrimaryButton>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Tech stack selection coming soon (Prisma, BullMQ, Grok, etc.)
            </p>
            <div className="flex gap-4">
              <PrimaryButton onClick={() => setStep(2)} variant="outline">
                Back
              </PrimaryButton>
              <PrimaryButton
                onClick={handleGenerate}
                disabled={loading}
                className="flex-1"
              >
                Generate Project
              </PrimaryButton>
            </div>
          </div>
        )}

        {step === 4 && tree && (
          <div className="space-y-6">
            <PrimaryButton
              onClick={handleDownload}
              disabled={loading}
              className="w-full"
            >
              Download ZIP
            </PrimaryButton>
            <PrimaryButton
              onClick={() => setStep(1)}
              variant="outline"
              className="w-full"
            >
              Start New Project
            </PrimaryButton>
          </div>
        )}
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
