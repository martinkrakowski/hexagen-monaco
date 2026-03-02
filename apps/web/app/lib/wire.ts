import type { ProjectSpec } from '@hexagen/project-configuration';
import type { FileTreeNode } from '@hexagen/project-configuration';
import { GenerateProjectUseCase } from '@hexagen/project-configuration';
import type { IDownloadProviderPort } from '@hexagen/project-configuration';
import { JSZipDownloadAdapter } from '@hexagen/project-configuration';

const generateUseCase = new GenerateProjectUseCase();
const downloadAdapter: IDownloadProviderPort = new JSZipDownloadAdapter();

export async function generateProjectAction(
  spec: ProjectSpec
): Promise<FileTreeNode> {
  'use server';
  try {
    const tree = await generateUseCase.execute(spec);
    // eslint-disable-next-line no-console
    console.log('Generated tree:', JSON.stringify(tree, null, 2));
    return tree;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Generation failed:', error);
    throw new Error('Failed to generate project');
  }
}

export async function downloadProjectAction(tree: FileTreeNode): Promise<Blob> {
  'use server';
  try {
    const blob = await downloadAdapter.download(tree);
    return blob;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Download failed:', error);
    throw new Error('Failed to create zip');
  }
}
