export type FileSystemNodeType = "file" | "directory";

export interface FileTreeNode {
  name: string;
  type: FileSystemNodeType;
  content?: string;
  children?: FileTreeNode[];
}
