import type {
  ExportConfig,
  ExportResult,
  ProjectExporterPort,
} from "../../application/ports/out/project-exporter.port.js";
import fs from "node:fs/promises";
import path from "node:path";

interface FileEntry {
  path: string;
  content: string;
  sha?: string;
}

export class GitHubExporterAdapter implements ProjectExporterPort {
  private baseUrl = "https://api.github.com";

  async export(
    sourceDirectory: string,
    config: ExportConfig,
  ): Promise<ExportResult> {
    try {
      if (config.destination !== "github" || !config.github) {
        return {
          success: false,
          destinationUrl: "",
          error: "Invalid destination or missing GitHub configuration",
        };
      }

      const { token, owner, repoName, isPrivate } = config.github;

      const createdRepo = await this.createRepo(
        token,
        owner,
        repoName,
        isPrivate,
      );
      if (!createdRepo) {
        return {
          success: false,
          destinationUrl: "",
          error: "Failed to create repository",
        };
      }

      const files = await this.readFiles(sourceDirectory);

      const blobs = await this.createBlobs(token, owner, repoName, files);

      const tree = await this.createTree(token, owner, repoName, blobs);

      const commitSha = await this.createCommit(
        token,
        owner,
        repoName,
        tree,
        "Initial commit: Hexagonal architecture scaffold",
      );

      await this.updateRef(token, owner, repoName, commitSha);

      return {
        success: true,
        destinationUrl: `https://github.com/${owner}/${repoName}`,
      };
    } catch (err) {
      return {
        success: false,
        destinationUrl: "",
        error:
          err instanceof Error ? err.message : "Failed to export to GitHub",
      };
    }
  }

  private async request(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        `GitHub API error (${response.status}): ${JSON.stringify(error)}`,
      );
    }

    return response.json();
  }

  private async createRepo(
    token: string,
    owner: string,
    repoName: string,
    isPrivate: boolean,
  ): Promise<boolean> {
    try {
      await this.request(token, "POST", "/user/repos", {
        name: repoName,
        private: isPrivate,
        auto_init: false,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already exists")) {
        return true;
      }
      throw err;
    }
  }

  private async readFiles(dirPath: string): Promise<FileEntry[]> {
    const files: FileEntry[] = [];

    const traverse = async (currentPath: string, basePath: string) => {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(basePath, fullPath);
        if (entry.isDirectory()) {
          await traverse(fullPath, basePath);
        } else {
          const content = await fs.readFile(fullPath);
          const base64 = content.toString("base64");
          files.push({
            path: relativePath,
            content: base64,
          });
        }
      }
    };

    await traverse(dirPath, dirPath);
    return files;
  }

  private async createBlobs(
    token: string,
    owner: string,
    repo: string,
    files: FileEntry[],
  ): Promise<FileEntry[]> {
    const blobPromises = files.map(async (file) => {
      const result = (await this.request(
        token,
        "POST",
        `/repos/${owner}/${repo}/git/blobs`,
        {
          content: file.content,
          encoding: "base64",
        },
      )) as { sha: string };
      return { ...file, sha: result.sha };
    });

    return Promise.all(blobPromises);
  }

  private async createTree(
    token: string,
    owner: string,
    repo: string,
    files: FileEntry[],
  ): Promise<string> {
    const tree = files.map((file) => ({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: file.sha,
    }));

    const result = (await this.request(
      token,
      "POST",
      `/repos/${owner}/${repo}/git/trees`,
      {
        tree,
      },
    )) as { sha: string };

    return result.sha;
  }

  private async createCommit(
    token: string,
    owner: string,
    repo: string,
    treeSha: string,
    message: string,
  ): Promise<string> {
    const result = (await this.request(
      token,
      "POST",
      `/repos/${owner}/${repo}/git/commits`,
      {
        message,
        tree: treeSha,
      },
    )) as { sha: string };

    return result.sha;
  }

  private async updateRef(
    token: string,
    owner: string,
    repo: string,
    commitSha: string,
  ): Promise<void> {
    await this.request(
      token,
      "PATCH",
      `/repos/${owner}/${repo}/git/refs/heads/main`,
      {
        sha: commitSha,
        force: true,
      },
    );
  }
}
