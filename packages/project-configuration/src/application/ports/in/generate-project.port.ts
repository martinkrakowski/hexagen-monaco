/* Port for use case: GenerateProject
 * Inbound (driving) port — called by Next.js driver / server actions
 */
import type { ProjectSpec } from '../../../domain/model/project-spec/project-spec';
import type { FileTreeNode } from '../../../domain/model/file-tree-node/file-tree-node';

export interface IGenerateProjectPort {
  execute(spec: ProjectSpec): Promise<FileTreeNode>;
}
