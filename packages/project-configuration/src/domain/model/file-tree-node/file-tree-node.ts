export type FileType = 'file' | 'folder';

export interface FileTreeNode {
  name: string;
  type: FileType;
  content?: string; // only for files
  children?: FileTreeNode[]; // only for folders
  path?: string; // optional for preview/deploy
}
