import type { FileTreeNode } from '../domain';

export const downloadProjectUseCase = {
  execute: async (tree: FileTreeNode): Promise<Buffer> => {
    return Buffer.from('placeholder');
  },
};
