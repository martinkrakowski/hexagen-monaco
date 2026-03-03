// packages/project-generation/src/domain/model/file-tree-node/file-tree-node.ts
// Pure domain value object - serializable tree node for generated project structure

export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  content?: string; // base64 or raw text for files
}
