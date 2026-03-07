import { z } from 'zod';
import { projectConfigSchema } from '@hexagen/project-configuration';
import type { FileTreeNode } from '../domain';

export const generateProjectUseCase = {
  execute: async (
    fullSpec: z.infer<typeof projectConfigSchema>
  ): Promise<FileTreeNode> => {
    // 1. Prune / map to minimal shape
    const minimalSpec = {
      rootName: fullSpec.name,
      // ... other fields
    };

    void minimalSpec;

    // 2. Return a valid FileTreeNode (The actual "output" of this port)
    // In a real scenario, this is where your generation logic would go.
    return {
      name: fullSpec.name,
      type: 'directory',
      children: [
        {
          name: 'README.md',
          type: 'file',
          content: `# ${fullSpec.name}\nGenerated via Hexagen.`,
        },
      ],
    };
  },
};
