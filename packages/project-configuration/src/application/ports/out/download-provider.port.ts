import type { FileTreeNode } from '../../../domain/model/file-tree-node/file-tree-node';

export interface IDownloadProviderPort {
  download(tree: FileTreeNode): Promise<Blob>;
}
