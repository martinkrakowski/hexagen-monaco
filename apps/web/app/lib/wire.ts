// apps/web/app/lib/wire.ts
// Wire layer — inbound adapters for web driver (Next.js App Router)

import { generateProjectUseCase } from '@hexagen/project-generation';
import type { ProjectConfig } from '@hexagen/project-configuration';
import type { Project } from '@hexagen/project-generation';

// Temporary stub port — MUST match current IGenerateProjectPort contract
const stubGeneratePort = {
  async generate(spec: any): Promise<void> {
    console.warn(
      '[STUB] generateProject port called — implement real FileSystemPort'
    );
    // No return value needed — port returns void
  },
};

// Inbound action (used by /api/generate/route.ts)
export async function generateProjectAction(
  spec: ProjectConfig
): Promise<Project> {
  // Create use-case instance with stub port
  const useCase = generateProjectUseCase(stubGeneratePort);

  // Execute use-case (returns domain Project entity)
  return useCase.execute(spec);
}

// Placeholder for download (not yet ported)
export async function downloadProjectAction(project: Project): Promise<Buffer> {
  throw new Error(
    'downloadProjectAction not yet implemented in hexagonal architecture'
  );
}
