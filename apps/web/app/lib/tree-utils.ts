import type { ViewFileNode } from "../components/code-view/types";
import { getLanguageForFile } from "./language-utils";

export function mapToFolderTree(files: Map<string, string>): ViewFileNode[] {
  const root: ViewFileNode[] = [];
  const nodeMap = new Map<string, ViewFileNode>();

  const paths = Array.from(files.keys()).sort();

  for (const filePath of paths) {
    const content = files.get(filePath);
    const parts = filePath.split("/");

    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const parentPath = currentPath;

      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!nodeMap.has(currentPath)) {
        const node: ViewFileNode = {
          id: currentPath,
          name: part,
          type: isFile ? "file" : "directory",
          parentId: parentPath || undefined,
        };

        if (isFile) {
          node.content = content;
          node.language = getLanguageForFile(part);
        } else {
          node.children = [];
        }

        nodeMap.set(currentPath, node);

        if (parentPath) {
          const parentNode = nodeMap.get(parentPath);
          if (parentNode && parentNode.children) {
            parentNode.children.push(node);
          }
        } else {
          root.push(node);
        }
      }
    }
  }

  return root;
}
