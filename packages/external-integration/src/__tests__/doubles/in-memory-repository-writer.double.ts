import type {
  RepositoryLink,
  RepositoryWriterPort,
  CommitResult,
  RepositoryWriterError,
} from "../../application/ports/out/repository-writer.port.js";
import type { Result } from "@hexagen/shared";

/**
 * In-memory double for RepositoryWriterPort. Simulates commit by recording
 * calls; returns a fake sha/url. Used to test call wiring without network.
 */
export class InMemoryRepositoryWriter implements RepositoryWriterPort {
  public commits: Array<{
    link: RepositoryLink;
    files: Record<string, string>;
    message: string;
  }> = [];

  async commitFiles(
    link: RepositoryLink,
    files: Record<string, string>,
    message: string,
  ): Promise<Result<CommitResult, RepositoryWriterError>> {
    // Snapshot inputs by value so later mutation of the caller's objects can't
    // retroactively change what we recorded (which would mask wiring bugs).
    this.commits.push({ link: { ...link }, files: { ...files }, message });
    const fakeSha =
      "deadbeef" + this.commits.length.toString().padStart(4, "0");
    return {
      success: true,
      value: {
        commitSha: fakeSha,
        commitUrl: `https://example.com/${link.owner}/${link.repo}/commit/${fakeSha}`,
      },
    };
  }
}
