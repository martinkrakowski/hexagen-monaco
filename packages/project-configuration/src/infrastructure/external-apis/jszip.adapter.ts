import JSZip from 'jszip';
import type { FileTreeNode } from '../../domain/model/file-tree-node/file-tree-node';
import type { IDownloadProviderPort } from '../../application/ports/out/download-provider.port';

export class JSZipDownloadAdapter implements IDownloadProviderPort {
  async download(tree: FileTreeNode): Promise<Blob> {
    const zip = new JSZip();

    const addToZip = (node: FileTreeNode, path: string = '') => {
      const currentPath = path ? `${path}/${node.name}` : node.name;

      if (node.type === 'file') {
        if (node.content !== undefined) {
          zip.file(currentPath, node.content);
        }
      } else if (node.type === 'folder' && node.children) {
        node.children.forEach((child) => addToZip(child, currentPath));
      }
    };

    addToZip(tree);

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    return zipBlob;
  }
}
