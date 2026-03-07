import type { Project } from '../../domain';

export class ProjectViewProjectionUseCase {
  projectTree(
    project: Project,
    options: {
      highlightLowConfidence?: boolean;
      expandedPaths?: Set<string>;
    } = {}
  ): ProjectTreeViewModel {
    const rootNodes: ProjectTreeNode[] = [];

    // Root files
    if (project.rootFiles) {
      Object.entries(project.rootFiles).forEach(([path, content]) => {
        rootNodes.push({
          id: `root/${path}`,
          name: path,
          type: 'file',
          contentPreview:
            content.slice(0, 100) + (content.length > 100 ? '...' : ''),
          isExpanded: false,
          children: [],
          confidence: 1.0,
        });
      });
    }

    // Bounded contexts
    project.boundedContexts.forEach((ctx) => {
      const ctxNode: ProjectTreeNode = {
        id: `bounded/${ctx.name}`,
        name: ctx.name,
        type: 'bounded-context',
        description: ctx.description,
        isExpanded: options.expandedPaths?.has(`bounded/${ctx.name}`) ?? false,
        children: [],
        confidence: 1.0,
      };

      // Layer placeholders – now with isExpanded
      ctxNode.children.push({
        id: `bounded/${ctx.name}/domain`,
        name: 'domain',
        type: 'layer',
        children: [],
        isExpanded: false,
        confidence: 1.0,
      });

      ctxNode.children.push({
        id: `bounded/${ctx.name}/application`,
        name: 'application',
        type: 'layer',
        children: [],
        isExpanded: false,
        confidence: 1.0,
      });

      rootNodes.push(ctxNode);
    });

    return {
      rootNodes,
      totalNodes:
        rootNodes.length +
        rootNodes.reduce((acc, n) => acc + (n.children?.length ?? 0), 0),
      lastProjected: new Date(),
    };
  }
}

export interface ProjectTreeViewModel {
  rootNodes: ProjectTreeNode[];
  totalNodes: number;
  lastProjected: Date;
}

export interface ProjectTreeNode {
  id: string;
  name: string;
  type: 'file' | 'bounded-context' | 'layer' | 'entity' | 'port' | 'use-case';
  description?: string;
  contentPreview?: string;
  isExpanded: boolean;
  children: ProjectTreeNode[];
  confidence: number;
}
