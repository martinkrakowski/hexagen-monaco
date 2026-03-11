import type { FileTreeNode } from '../../../domain/model/file-tree-node/file-tree-node';

export interface DownloadProviderPort {
  download(tree: FileTreeNode): Promise<Blob>;
}
