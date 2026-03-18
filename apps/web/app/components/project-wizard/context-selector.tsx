"use client";

import type { BoundedContext } from "@hexagen/shared";
import { IProjectWizardController } from "@hexagen/wizard-orchestration";

interface ContextSelectorProps {
  contexts: BoundedContext[];
  activeId: string;
  controller: IProjectWizardController;
}

export function ContextSelector({
  contexts,
  activeId,
  controller,
}: ContextSelectorProps) {
  const handleContextChange = (id: string) => {
    controller.setActiveContextId(id);
  };

  return (
    <div className="flex items-center justify-between p-3 mb-6 bg-slate-900 border border-slate-700 rounded-md">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wider px-2">
        Editing Context:
      </span>
      <select
        value={activeId}
        onChange={(e) => handleContextChange(e.target.value)}
        className="w-[240px] h-8 px-3 bg-slate-800 border border-slate-600 rounded text-sm text-slate-200"
      >
        {contexts.map((ctx) => (
          <option key={ctx.id} value={ctx.id}>
            {ctx.name || `Context ${ctx.id.slice(0, 8)}...`}
          </option>
        ))}
      </select>
    </div>
  );
}
