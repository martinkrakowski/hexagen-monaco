// apps/web/app/lib/wire.ts
// Inbound driver adapter layer — orchestrates bounded contexts for web actions

import { createWebUseCaseFactories } from '@hexagen/web-driver';
import type { Project as WebProject } from '@hexagen/web-driver';
import { GenerateProjectUseCase } from '@hexagen/project-generation';
import type { ProjectConfig } from '@hexagen/project-configuration';

// Singleton factories (web-driver context)
const webFactories = createWebUseCaseFactories();

export async function generateProjectAction(
  rawSpec: ProjectConfig
): Promise<WebProject> {
  // Temp no-op port — replace with real infrastructure adapter
  const tempPort = {
    async generate(): Promise<void> {
      // TODO: wire real generator
    },
  };

  const useCase = new GenerateProjectUseCase(tempPort);
  const project = await useCase.execute(rawSpec);

  const webProject: WebProject = {
    id: project.id,
    spec: {
      name: project.name,
      description: '',
    },
    boundedContexts: [],
    rootFiles: {},
    lastGeneratedAt: new Date(),
  };

  const projection = webFactories.createProjectViewProjectionUseCase();
  const tree = projection.projectTree(webProject);
  console.debug('[DEBUG] Generated project tree nodes:', tree.totalNodes);

  return webProject;
}

export async function downloadProjectAction(
  project: WebProject
): Promise<{ success: boolean; downloadUrl?: string; message: string }> {
  const downloadUseCase = webFactories.createDownloadProjectUseCase();
  return downloadUseCase.execute(project);
}
