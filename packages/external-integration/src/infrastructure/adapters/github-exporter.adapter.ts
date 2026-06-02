import type {
  ExportConfig,
  ExportResult,
  ProjectExporterPort,
} from "@hexagen/project-generation";
import fs from "node:fs/promises";
import path from "node:path";
import {
  GitHubGitDataClient,
  GitHubApiError,
} from "./github-git-data.client.js";

interface FileEntry {
  path: string;
  content: string;
  sha?: string;
}

/**
 * GitHub exporter adapter (relocated from project-generation for
 * infrastructure plane + sharing Git Data client with commit path).
 * Implements the ProjectExporterPort consumed by project-generation use cases.
 */
export class GitHubExporterAdapter implements ProjectExporterPort {
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
      const client = new GitHubGitDataClient();

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

      // create blobs via client (base64 already)
      const fileShas: FileEntry[] = [];
      for (const f of files) {
        const sha = await client.createBlob(
          token,
          owner,
          repoName,
          f.content,
          "base64",
        );
        fileShas.push({ ...f, sha });
      }

      const treeEntries = fileShas.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        sha: f.sha!,
      }));
      const treeSha = await client.createTree(
        token,
        owner,
        repoName,
        treeEntries,
      );

      const parentSha = await client.getBranchHeadSha(
        token,
        owner,
        repoName,
        "main",
      );

      const commitSha = await client.createCommit(
        token,
        owner,
        repoName,
        treeSha,
        parentSha
          ? "Update project: Hexagonal architecture scaffold"
          : "Initial commit: Hexagonal architecture scaffold",
        parentSha ? [parentSha] : [],
      );

      await client.upsertRef(
        token,
        owner,
        repoName,
        "main",
        commitSha,
        parentSha !== null,
      );

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

  private async createRepo(
    token: string,
    owner: string,
    repoName: string,
    isPrivate: boolean,
  ): Promise<boolean> {
    try {
      // Inline minimal request to keep test mocks (which spy on global fetch + expect json error shape) happy.
      const base = "https://api.github.com";
      // auto_init: true creates an initial commit so the repo is non-empty.
      // A repo created with auto_init:false has no git objects yet, and GitHub's
      // Git Data API then rejects blob/tree creation with
      // `409 Git Repository is empty`. With an initial commit present, the
      // export's getBranchHeadSha("main") returns that commit and the scaffold is
      // committed on top of it as a fast-forward (see export()).
      const r = await fetch(`${base}/user/repos`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          name: repoName,
          private: isPrivate,
          auto_init: true,
        }),
      });
      if (!r.ok) {
        const error = await r.json().catch(() => ({}));
        const msg = JSON.stringify(error);
        if (msg.includes("already exists")) return true;
        throw new GitHubApiError(
          r.status,
          `GitHub API error (${r.status}): ${msg}`,
        );
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already exists")) return true;
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
}
