import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ANON_SESSION_COOKIE } from "../../../../../lib/anon-session";
import { getQuotaStore, QUOTA_LIMITS } from "../../../../../lib/quota-store";
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
  /** Anonymous-session cookie value; omit to arrive as a fresh visitor. */
  sid?: string;
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
  if (fields.sid) headers.set("cookie", `${ANON_SESSION_COOKIE}=${fields.sid}`);
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

/**
 * Free-tier scan quota (BF-5.1 / F-10). The per-IP limiter is mocked open for
 * the whole file, so anything asserted here is the *quota* gate — the daily
 * per-session cap — not the rate limiter.
 */
describe("POST /api/projects/scan — free-tier scan quota", () => {
  // Frozen mid-day UTC: the store buckets by UTC day, so a run straddling
  // midnight would otherwise read a fresh bucket and flake.
  beforeEach(() => {
    vi.useFakeTimers({
      now: Date.UTC(2026, 7, 20, 12, 0, 0),
      toFake: ["Date"],
    });
    scanZip.mockReset();
    scanZip.mockResolvedValue({ kind: "scanned", result: PASS_RESULT });
  });
  afterEach(() => vi.useRealTimers());

  it("mints the anon-session cookie the daily cap is keyed on", async () => {
    const res = await postForm({ name: "Demo", zip: dummyZip() });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("set-cookie")?.includes(ANON_SESSION_COOKIE));
  });

  it("charges exactly one scan per successful request", async () => {
    const sid = "11111111-1111-4111-8111-111111111111";
    const store = getQuotaStore();

    await postForm({ name: "Demo", zip: dummyZip(), sid });
    assert.equal(store.peek(sid, "scan").used, 1);

    await postForm({ name: "Demo", zip: dummyZip(), sid });
    assert.equal(store.peek(sid, "scan").used, 2);
  });

  it("does not charge a scan that failed validation", async () => {
    const sid = "22222222-2222-4222-8222-222222222222";
    const res = await postForm({ zip: dummyZip(), sid }); // no name
    assert.equal(res.status, 400);
    assert.equal(getQuotaStore().peek(sid, "scan").used, 0);
  });

  it("does not charge a cross-origin request the guard already rejected", async () => {
    const sid = "33333333-3333-4333-8333-333333333333";
    const res = await postForm({
      name: "Demo",
      zip: dummyZip(),
      sid,
      origin: "https://evil.example",
    });
    assert.equal(res.status, 403);
    assert.equal(getQuotaStore().peek(sid, "scan").used, 0);
  });

  it("429s once the daily cap is spent, without running the CLI", async () => {
    const sid = "44444444-4444-4444-8444-444444444444";
    const store = getQuotaStore();
    for (let i = 0; i < QUOTA_LIMITS.scan; i++) store.consume(sid, "scan");

    const res = await postForm({ name: "Demo", zip: dummyZip(), sid });
    assert.equal(res.status, 429);
    assert.equal(scanZip.mock.calls.length, 0);
    assert.ok(Number(res.headers.get("retry-after")) >= 1);

    const body = (await res.json()) as { error: string; kind: string };
    // `kind` is what tells this apart from guardMutation's rate-limit 429.
    assert.equal(body.kind, "scan");
    assert.match(body.error, /daily limit/i);

    // The refusal must not have counted an 11th scan.
    assert.equal(store.peek(sid, "scan").used, QUOTA_LIMITS.scan);
  });
});

describe("GET /api/projects/scan", () => {
  it("returns 405", async () => {
    const res = await GET();
    assert.equal(res.status, 405);
  });
});
