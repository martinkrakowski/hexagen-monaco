#!/usr/bin/env node
/**
 * Post or update the per-PR conformance comment. Silent when the comment
 * file is empty (clean PR). Deletes a previous comment from this action
 * when the PR has gone clean so a stale list does not linger.
 *
 * Marker: `<!-- hexagen-conformance -->`
 *
 * The posted body is the linter's own report followed by a "Review in
 * Hexagen-Monaco" deep link prefilled with `?repo=<owner/repo>&pr=<number>`.
 * The link is appended (never substituted) and only on the code paths that
 * already post, so a clean PR still leaves no comment. `HEXAGEN_APP_URL`
 * overrides the host; an unparseable value costs the link, not the comment.
 *
 * Provenance: vendored verbatim from Hexagen-Monaco's
 * `HEXAGEN_CONFORMANCE_COMMENT_SCRIPT`
 * (`packages/project-generation/src/domain/sync-integrity-workflow.ts`).
 * Upstream a test asserts the two copies stay byte-identical, so edit both or
 * neither; a local edit here is overwritten on the next sync.
 */
import { readFileSync } from "node:fs";

const MARKER = "<!-- hexagen-conformance -->";
const DEFAULT_APP_URL = "https://hexagen-monaco.cloud";
const REVIEW_PATH = "/projects/new/import/github";

const token = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GH_REPO ?? "";
const pr = process.env.PR_NUMBER ?? "";
const file = process.env.COMMENT_FILE ?? "";
const appUrl = process.env.HEXAGEN_APP_URL?.trim() || DEFAULT_APP_URL;

if (!token || !repo || !pr) {
  process.stderr.write(
    "hexagen-conformance: missing GITHUB_TOKEN / GH_REPO / PR_NUMBER — skipping comment\n",
  );
  process.exit(0);
}

/**
 * The trailing "Review in Hexagen-Monaco" link. `searchParams` percent-encodes
 * the `owner/repo` slash, so the prefill survives the round trip.
 */
function reviewFooter() {
  let url;
  try {
    url = new URL(REVIEW_PATH, appUrl);
  } catch {
    process.stderr.write(
      `hexagen-conformance: ignoring unparseable HEXAGEN_APP_URL (${appUrl})\n`,
    );
    return "";
  }
  url.searchParams.set("repo", repo);
  url.searchParams.set("pr", pr);
  return `\n\n---\n\n[Review in Hexagen-Monaco](${url.toString()})\n`;
}

let body = "";
try {
  body = readFileSync(file, "utf8");
} catch {
  body = "";
}

if (body.trim() && !body.includes(MARKER)) {
  body = `${MARKER}\n${body}`;
}

const api = `https://api.github.com/repos/${repo}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "hexagen-conformance",
};

async function listComments() {
  const all = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(
      `${api}/issues/${pr}/comments?per_page=100&page=${page}`,
      { headers },
    );
    if (!res.ok) {
      throw new Error(`list comments ${res.status}`);
    }
    const batch = /** @type {Array<{ id: number; body?: string }>} */ (
      await res.json()
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

const comments = await listComments();
const existing = comments.find((c) => (c.body ?? "").includes(MARKER));

if (!body.trim()) {
  if (existing) {
    const del = await fetch(`${api}/issues/comments/${existing.id}`, {
      method: "DELETE",
      headers,
    });
    if (!del.ok && del.status !== 404) {
      process.stderr.write(
        `hexagen-conformance: could not delete stale comment (${del.status})\n`,
      );
    }
  }
  process.exit(0);
}

// Past the silence gate: this PR has new violations, so the comment is going
// out either way and the deep link rides along with it.
body += reviewFooter();

if (existing) {
  const res = await fetch(`${api}/issues/comments/${existing.id}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    process.stderr.write(
      `hexagen-conformance: could not update comment (${res.status})\n`,
    );
  }
} else {
  const res = await fetch(`${api}/issues/${pr}/comments`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    process.stderr.write(
      `hexagen-conformance: could not post comment (${res.status})\n`,
    );
  }
}
