import type { FileTreeNode } from "@hexagen/shared";

export interface ViewFileNode extends FileTreeNode {
  id: string;
  parentId?: string;
  language?: string;
  children?: ViewFileNode[];
}
