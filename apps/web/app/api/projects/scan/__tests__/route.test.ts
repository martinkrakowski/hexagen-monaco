import { beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { ProjectScanResponse } from "@/lib/project-scan/types";
import {
  MAX_PROJECT_NAME_CHARS,
  MAX_SCAN_REQUEST_BYTES,
} from "@/lib/project-scan/limits";

const scanZip = vi.hoisted(() => vi.fn());

vi.mock("@/lib/project-scan/cli-hexagen-scan.adapter", () => ({
  CliHexagenScanAdapter: {
    fromMonorepoRoot: () => ({ scanZip }),
  },
}));

vi.mock("../../../../../lib/rate-limiter", () => ({
  checkRateLimit: () => ({ allowed: true }),
}));

import { GET, POST } from "../route";

function dummyZip(filename = "repo.zip"): File {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x20, 0x20]);
  return {
    name: filename,
    size: bytes.byteLength,
    type: "application/zip",
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as File;
}

async function postForm(fields: {
  name?: string;
  zip?: File;
  origin?: string;
  contentLength?: string;
  onFormData?: () => void;
}): Promise<Response> {
  const form = {
    get(key: string): FormDataEntryValue | null {
      if (key === "name") {
        return fields.name === undefined ? null : fields.name;
      }
      if (key === "zip") {
        return fields.zip ?? null;
      }
      return null;
    },
  } as FormData;
  const headers = new Headers();
  if (fields.origin) headers.set("origin", fields.origin);
  if (fields.contentLength !== undefined) {
    headers.set("content-length", fields.contentLength);
  }
  const request = new NextRequest("http://localhost/api/projects/scan", {
    method: "POST",
    headers,
  });
  // NextRequest+FormData streaming hangs under Vitest/jsdom when a File is
  // attached, and `vi.spyOn(request, "formData")` does not stick on NextRequest.
  // Hand the fields in directly; the production route still calls request.formData().
  Object.defineProperty(request, "formData", {
    value: async () => {
      fields.onFormData?.();
      return form;
    },
  });
  return POST(request);
}

const PASS_RESULT: ProjectScanResponse = {
  verdict: "pass",
  exitCode: 0,
  projectName: "Demo",
  layoutExcerpt: "contexts: {}\n",
  filesScanned: 3,
  reportMarkdown: "# ok\n",
  errorMessage: null,
};

describe("POST /api/projects/scan", () => {
  beforeEach(() => {
    scanZip.mockReset();
    scanZip.mockResolvedValue({ kind: "scanned", result: PASS_RESULT });
  });

  it("400s when the project name is missing", async () => {
    const res = await postForm({ zip: dummyZip() });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /name/i);
    assert.equal(scanZip.mock.calls.length, 0);
  });

  it("400s when the zip is missing", async () => {
    const res = await postForm({ name: "Demo" });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /zip/i);
    assert.equal(scanZip.mock.calls.length, 0);
  });

  it("400s a too-long project name", async () => {
    const res = await postForm({
      name: "x".repeat(MAX_PROJECT_NAME_CHARS + 1),
      zip: dummyZip(),
    });
    assert.equal(res.status, 400);
    assert.equal(scanZip.mock.calls.length, 0);
  });

  it("413s an oversized Content-Length before parsing the body", async () => {
    let formDataCalled = false;
    const res = await postForm({
      name: "Demo",
      zip: dummyZip(),
      contentLength: String(MAX_SCAN_REQUEST_BYTES + 1),
      onFormData: () => {
        formDataCalled = true;
      },
    });
    assert.equal(res.status, 413);
    assert.equal(formDataCalled, false);
    assert.equal(scanZip.mock.calls.length, 0);
  });

  it("400s a non-numeric Content-Length before parsing the body", async () => {
    let formDataCalled = false;
    const res = await postForm({
      name: "Demo",
      zip: dummyZip(),
      contentLength: "not-a-number",
      onFormData: () => {
        formDataCalled = true;
      },
    });
    assert.equal(res.status, 400);
    assert.equal(formDataCalled, false);
    assert.equal(scanZip.mock.calls.length, 0);
  });

  it("400s zip-too-large from the adapter", async () => {
    scanZip.mockResolvedValue({
      kind: "rejected",
      reason: "zip-too-large",
      message: "Zip has too many entries (exceeds 1) and was rejected",
    });
    const res = await postForm({
      name: "Demo",
      zip: dummyZip(),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; reason: string };
    assert.equal(body.reason, "zip-too-large");
    assert.match(body.error, /too many entries/i);
  });

  it("400s zip-slip from the adapter without treating it as a scan verdict", async () => {
    scanZip.mockResolvedValue({
      kind: "rejected",
      reason: "zip-slip",
      message: "Zip contains an unsafe path and was rejected",
    });
    const res = await postForm({
      name: "Demo",
      zip: dummyZip(),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; reason: string };
    assert.equal(body.reason, "zip-slip");
    assert.match(body.error, /unsafe path/i);
  });

  it("returns pass from the adapter", async () => {
    const res = await postForm({ name: "Demo", zip: dummyZip() });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as ProjectScanResponse).verdict, "pass");
  });

  it("returns violations from the adapter", async () => {
    scanZip.mockResolvedValue({
      kind: "scanned",
      result: { ...PASS_RESULT, verdict: "violations", exitCode: 1 },
    });
    const res = await postForm({ name: "Demo", zip: dummyZip() });
    assert.equal(res.status, 200);
    assert.equal(
      ((await res.json()) as ProjectScanResponse).verdict,
      "violations",
    );
  });

  it("returns could-not-run from the adapter and surfaces the CLI error", async () => {
    scanZip.mockResolvedValue({
      kind: "scanned",
      result: {
        ...PASS_RESULT,
        verdict: "could-not-run",
        exitCode: 2,
        errorMessage: "No workspace packages found.",
      },
    });
    const res = await postForm({ name: "Demo", zip: dummyZip() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as ProjectScanResponse;
    assert.equal(body.verdict, "could-not-run");
    assert.match(body.errorMessage ?? "", /No workspace packages/);
  });

  it("rejects a cross-origin POST", async () => {
    const res = await postForm({
      name: "Demo",
      zip: dummyZip(),
      origin: "https://evil.example",
    });
    assert.equal(res.status, 403);
    assert.equal(scanZip.mock.calls.length, 0);
  });
});

describe("GET /api/projects/scan", () => {
  it("returns 405", async () => {
    const res = await GET();
    assert.equal(res.status, 405);
  });
});
