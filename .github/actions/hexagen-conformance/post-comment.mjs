#!/usr/bin/env node
/**
 * Post or update the per-PR conformance comment. Silent when the comment
 * file is empty (clean PR). Deletes a previous comment from this action
 * when the PR has gone clean so a stale list does not linger.
 *
 * Marker: `<!-- hexagen-conformance -->`
 */
import { readFileSync } from "node:fs";

const MARKER = "<!-- hexagen-conformance -->";

const token = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GH_REPO ?? "";
const pr = process.env.PR_NUMBER ?? "";
const file = process.env.COMMENT_FILE ?? "";

if (!token || !repo || !pr) {
  process.stderr.write(
    "hexagen-conformance: missing GITHUB_TOKEN / GH_REPO / PR_NUMBER — skipping comment\n",
  );
  process.exit(0);
}

let body = "";
try {
  body = readFileSync(file, "utf8");
} catch {
  body = "";
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
