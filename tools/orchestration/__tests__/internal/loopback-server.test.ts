import { describe, expect, test } from "vitest";
import {
  parseLoopbackServer,
  SESSION_ID_PATTERN,
} from "../../src/internal/loopback-server.js";

describe("parseLoopbackServer", () => {
  test.each([
    "http://127.0.0.1:4097",
    "http://127.0.0.1:4097/",
    "http://localhost:4097",
    "http://[::1]:4097",
    "https://127.0.0.1:4097",
    "http://127.3.4.5:80",
  ])("accepts %s", (raw) => {
    const result = parseLoopbackServer(raw);
    expect(result.ok, raw).toBe(true);
  });

  test.each([
    ["http://example.com:4096", "non-loopback host"],
    ["http://127.0.0.1.evil.com:4096", "loopback-looking suffix"],
    ["http://localhost.evil.com", "localhost-looking suffix"],
    ["http://0.0.0.0:4096", "wildcard address"],
    ["http://192.168.1.5:4096", "private LAN address"],
    ["ftp://127.0.0.1", "non-http scheme"],
    ["127.0.0.1:4097", "no scheme"],
    ["", "empty"],
    ["http://user:pw@127.0.0.1:4097", "credentials"],
    ["http://127.0.0.1:4097/api", "a path"],
    ["http://127.0.0.1:4097/?a=1", "a query"],
    ["http://127.0.0.1:4097/#x", "a fragment"],
  ])("refuses %s (%s)", (raw) => {
    const result = parseLoopbackServer(raw);
    expect(result.ok, raw).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  test("returns the origin with no trailing slash", () => {
    const result = parseLoopbackServer("http://localhost:4097/");
    expect(result).toEqual({ ok: true, origin: "http://localhost:4097" });
  });
});

describe("SESSION_ID_PATTERN", () => {
  test.each(["ses_abc123", "ses_4Fq9ZxLm", "a-b_c"])("accepts %s", (id) => {
    expect(SESSION_ID_PATTERN.test(id)).toBe(true);
  });
  test.each([
    "",
    "../etc",
    "a/b",
    "a b",
    "a?b",
    "a#b",
    "x".repeat(129),
    "a\n",
    "a.b",
    "..",
  ])("refuses %j", (id) => {
    expect(SESSION_ID_PATTERN.test(id)).toBe(false);
  });
});
