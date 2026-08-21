/**
 * HTTP mapping for POST /api/projects/scan/artifacts (Tier-A handoff ingest).
 *
 * Deliberately end-to-end below the transport: only the rate limiter is mocked.
 * The zips are real, the unpacker is real, the parser is real — so these tests
 * prove the *actual* status a crafted archive receives, not the status a mocked
 * adapter was told to return.
 *
 * Lives beside the parser tests (rather than under the route's own directory)
 * because this packet's scope fence confines new tests to this folder.
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import JSZip from "jszip";
import {
  MAX_HANDOFF_REQUEST_BYTES,
  MAX_HANDOFF_UPLOAD_BYTES,
  type ProjectHandoffResponse,
} from "../artifact-parse";
import { MAX_PROJECT_NAME_CHARS, TIER_A_MAX_ZIP_ENTRIES } from "../limits";

vi.mock("../../../../lib/rate-limiter", () => ({
  checkRateLimit: () => ({ allowed: true }),
}));

import { GET, POST } from "../../../api/projects/scan/artifacts/route";

const REPORT = "# Hexagen engagement report — Demo\n";

async function zipBytes(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}

function asFile(
  bytes: Uint8Array,
  name: string,
  type = "application/zip",
): File {
  return {
    name,
    size: bytes.byteLength,
    type,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as File;
}

interface PostOptions {
  name?: string;
  zip?: File;
  loose?: Array<[string, File]>;
  origin?: string;
  contentLength?: string;
  onFormData?: () => void;
}

async function postForm(options: PostOptions): Promise<Response> {
  const parts: Array<[string, FormDataEntryValue]> = [];
  if (options.name !== undefined) parts.push(["name", options.name]);
  if (options.zip) parts.push(["zip", options.zip]);
  for (const [field, file] of options.loose ?? []) parts.push([field, file]);

  const form = {
    get(key: string): FormDataEntryValue | null {
      const hit = parts.find(([field]) => field === key);
      return hit ? hit[1] : null;
    },
    entries: () => parts[Symbol.iterator](),
  } as unknown as FormData;

  const headers = new Headers();
  if (options.origin) headers.set("origin", options.origin);
  if (options.contentLength !== undefined) {
    headers.set("content-length", options.contentLength);
  }
  const request = new NextRequest(
    "http://localhost/api/projects/scan/artifacts",
    { method: "POST", headers },
  );
  // NextRequest+FormData streaming hangs under Vitest/jsdom when a File is
  // attached, and `vi.spyOn(request, "formData")` does not stick on NextRequest.
  // Hand the parts in directly; the route still calls request.formData().
  Object.defineProperty(request, "formData", {
    value: async () => {
      options.onFormData?.();
      return form;
    },
  });
  return POST(request);
}

describe("POST /api/projects/scan/artifacts", () => {
  it("200s a well-formed handoff zip and returns the parsed report", async () => {
    const zip = asFile(
      await zipBytes({
        "hexagen-report.md": REPORT,
        "suppression-ledger.json": JSON.stringify({ entries: [] }),
      }),
      "hexagen-handoff.zip",
    );
    const res = await postForm({ name: "Demo", zip });

    assert.equal(res.status, 200);
    const body = (await res.json()) as ProjectHandoffResponse;
    assert.equal(body.source, "handoff-artifacts");
    assert.equal(body.verdict, "ingested");
    assert.equal(body.projectName, "Demo");
    assert.match(body.reportMarkdown ?? "", /engagement report/);
    assert.equal(body.exitCode, null);
  });

  it("200s loose artifact files with no zip at all", async () => {
    const res = await postForm({
      name: "Demo",
      loose: [
        [
          "hexagen-report.md",
          asFile(
            new TextEncoder().encode(REPORT),
            "hexagen-report.md",
            "text/markdown",
          ),
        ],
      ],
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as ProjectHandoffResponse;
    assert.equal(body.verdict, "ingested");
  });

  it("400s a zip-slip archive — not 500, not a soft could-not-run", async () => {
    const zip = asFile(
      await zipBytes({ "hexagen-report.md": REPORT, "../outside.txt": "x" }),
      "evil.zip",
    );
    const res = await postForm({ name: "Demo", zip });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; reason: string };
    assert.equal(body.reason, "zip-slip");
    assert.match(body.error, /unsafe path/i);
  });

  it("400s an archive over the Tier-A entry cap", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= TIER_A_MAX_ZIP_ENTRIES; i += 1) {
      files[`f${i}.txt`] = "x";
    }
    const res = await postForm({
      name: "Demo",
      zip: asFile(await zipBytes(files), "big.zip"),
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { reason: string };
    assert.equal(body.reason, "zip-too-large");
  });

  it("400s a duplicate-entry archive", async () => {
    const zip = new JSZip();
    zip.file("hexagen-report.md", "a");
    zip.file("hexagen-report.md/", "b");
    const res = await postForm({
      name: "Demo",
      zip: asFile(await zip.generateAsync({ type: "uint8array" }), "dup.zip"),
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { reason: string };
    assert.equal(body.reason, "duplicate-zip-entry");
  });

  it("400s a zip carrying no handoff artifacts", async () => {
    const res = await postForm({
      name: "Demo",
      zip: asFile(await zipBytes({ "src/a.ts": "export {};" }), "src.zip"),
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { reason: string };
    assert.equal(body.reason, "no-artifacts");
  });

  it("200s despite malformed JSON in the baseline, surfacing a warning", async () => {
    const zip = asFile(
      await zipBytes({
        "hexagen-report.md": REPORT,
        "arch-lint-baseline.json": "{ not json",
      }),
      "handoff.zip",
    );
    const res = await postForm({ name: "Demo", zip });

    assert.equal(res.status, 200);
    const body = (await res.json()) as ProjectHandoffResponse;
    assert.equal(body.artifacts.baselineVersion, null);
    assert.ok(body.warnings.some((w) => /not valid JSON/.test(w)));
  });

  it("400s when the project name is missing", async () => {
    const res = await postForm({
      zip: asFile(await zipBytes({ "hexagen-report.md": REPORT }), "h.zip"),
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /name/i);
  });

  it("400s a too-long project name", async () => {
    const res = await postForm({
      name: "x".repeat(MAX_PROJECT_NAME_CHARS + 1),
      zip: asFile(await zipBytes({ "hexagen-report.md": REPORT }), "h.zip"),
    });
    assert.equal(res.status, 400);
  });

  it("400s when nothing at all was uploaded", async () => {
    const res = await postForm({ name: "Demo" });
    assert.equal(res.status, 400);
    assert.match(
      ((await res.json()) as { error: string }).error,
      /--handoff/,
    );
  });

  it("400s a non-zip upload in the zip slot", async () => {
    const res = await postForm({
      name: "Demo",
      zip: asFile(new TextEncoder().encode("hi"), "notes.txt", "text/plain"),
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /\.zip/i);
  });

  it("400s a zip above the Tier-A compressed upload cap", async () => {
    const bytes = await zipBytes({ "hexagen-report.md": REPORT });
    const oversized = {
      ...asFile(bytes, "h.zip"),
      size: MAX_HANDOFF_UPLOAD_BYTES + 1,
    } as File;
    const res = await postForm({ name: "Demo", zip: oversized });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /too large/i);
  });

  it("413s an oversized Content-Length before parsing the body", async () => {
    let parsed = false;
    const res = await postForm({
      name: "Demo",
      contentLength: String(MAX_HANDOFF_REQUEST_BYTES + 1),
      onFormData: () => {
        parsed = true;
      },
    });
    assert.equal(res.status, 413);
    assert.equal(parsed, false);
  });

  it("400s a non-numeric Content-Length before parsing the body", async () => {
    let parsed = false;
    const res = await postForm({
      name: "Demo",
      contentLength: "not-a-number",
      onFormData: () => {
        parsed = true;
      },
    });
    assert.equal(res.status, 400);
    assert.equal(parsed, false);
  });

  it("403s a cross-origin POST", async () => {
    let parsed = false;
    const res = await postForm({
      name: "Demo",
      origin: "https://evil.example",
      onFormData: () => {
        parsed = true;
      },
    });
    assert.equal(res.status, 403);
    assert.equal(parsed, false);
  });
});

describe("GET /api/projects/scan/artifacts", () => {
  it("returns 405 with an Allow: POST header", async () => {
    const res = await GET();
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("Allow"), "POST");
  });

  it("413s a chunked oversized body that declares no Content-Length", async () => {
    // The attack shape the Content-Length guard cannot see: chunked transfer
    // encoding omits the header entirely, so the pre-parse check returns null.
    // Before the capped read, formData() would then buffer the whole payload
    // and every size check downstream ran only after it was already in memory.
    //
    // Uses a REAL body stream (not the stubbed formData of the helper above),
    // because the whole point is what happens while the body is being read.
    let pushed = 0;
    const chunk = new Uint8Array(64 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        // Deliberately unbounded: a well-behaved route must stop pulling on
        // its own rather than rely on the producer ever ending.
        pushed += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const request = new NextRequest(
      "http://localhost/api/projects/scan/artifacts",
      {
        method: "POST",
        headers: new Headers({
          "content-type": "multipart/form-data; boundary=----probe",
        }),
        body,
        // @ts-expect-error -- duplex is required for a streaming body and is
        // not in the lib.dom RequestInit typing.
        duplex: "half",
      },
    );

    const response = await POST(request);

    assert.equal(response.status, 413);
    // Bounded: it stopped pulling shortly after the cap instead of draining an
    // endless producer. Asserting the 413 alone would pass even if it had.
    assert.ok(
      pushed < MAX_HANDOFF_REQUEST_BYTES * 2,
      `read ${pushed} bytes, which is not a bounded read`,
    );
  });
});
