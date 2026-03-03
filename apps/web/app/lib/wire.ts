import {
  generateProjectUseCase,
  downloadProjectUseCase,
} from '@hexagen/project-generation';
import type { FileTreeNode } from '@hexagen/project-generation';
import type { ProjectConfig } from '@hexagen/project-configuration';

// Inbound port adapters
export async function generateProjectAction(
  spec: ProjectConfig
): Promise<FileTreeNode> {
  return generateProjectUseCase.execute(spec);
}

export async function downloadProjectAction(
  tree: FileTreeNode
): Promise<Buffer> {
  return downloadProjectUseCase.execute(tree);
}
