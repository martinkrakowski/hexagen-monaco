import { describe, expect, test } from "vitest";
import { THREADS_QUERY, fetchAllThreads } from "../../src/sweep/lib/sweep.js";
import { REPO } from "../sweep/support.js";

/**
 * The fix-brief bin reads the same paginated, fail-closed fetch as sweep. It
 * needs four more fields off each thread to say where a finding sits: the
 * file, the line, the line at the time it was written, and whether the file
 * has moved under it.
 */

const page = (nodes: readonly unknown[]): string =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          id: "PR_1",
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes,
          },
        },
      },
    },
  });

describe("the threads fetch carries each thread's anchor", () => {
  test("the query selects path, line, originalLine and isOutdated", () => {
    for (const field of ["path", "line", "originalLine", "isOutdated"]) {
      expect(THREADS_QUERY, field).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  test("a thread's anchor comes back on the parsed thread", async () => {
    const fetched = await fetchAllThreads(
      7,
      async () =>
        page([
          {
            id: "PRRT_a",
            isResolved: false,
            path: "src/a.ts",
            line: 12,
            originalLine: 10,
            isOutdated: false,
            comments: { nodes: [{ author: { login: "bot" }, body: "x" }] },
          },
        ]),
      REPO,
    );
    expect(fetched.failures).toEqual([]);
    expect(fetched.threads[0]).toMatchObject({
      id: "PRRT_a",
      path: "src/a.ts",
      line: 12,
      originalLine: 10,
      isOutdated: false,
    });
  });

  test("a file-level thread has null lines, and a missing field is never invented", async () => {
    const fetched = await fetchAllThreads(
      7,
      async () =>
        page([
          {
            id: "PRRT_b",
            isResolved: false,
            path: "README.md",
            line: null,
            originalLine: null,
            isOutdated: true,
            comments: { nodes: [] },
          },
          { id: "PRRT_c", isResolved: false, comments: { nodes: [] } },
        ]),
      REPO,
    );
    expect(fetched.threads[0]).toMatchObject({
      path: "README.md",
      line: null,
      originalLine: null,
      isOutdated: true,
    });
    expect(fetched.threads[1]).toMatchObject({
      path: "",
      line: null,
      originalLine: null,
      isOutdated: false,
    });
  });
});
