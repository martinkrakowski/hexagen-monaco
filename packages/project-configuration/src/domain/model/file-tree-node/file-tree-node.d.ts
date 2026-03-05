export type FileType = 'file' | 'folder';
export interface FileTreeNode {
    name: string;
    type: FileType;
    content?: string;
    children?: FileTreeNode[];
    path?: string;
}
//# sourceMappingURL=file-tree-node.d.ts.map