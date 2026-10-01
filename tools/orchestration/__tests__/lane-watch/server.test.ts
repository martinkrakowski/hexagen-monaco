import { describe, expect, test, vi } from "vitest";
import { isAllowedPath, makeGet } from "../../src/lane-watch/server.js";

describe("the pathname allowlist", () => {
  test.each(["/global/event", "/session/ses_abc123", "/session/a-b_C"])(
    "allows %s",
    (path) => expect(isAllowedPath(path)).toBe(true),
  );

  test.each([
    "/",
    "/admin",
    "/global",
    "/global/event/",
    "/global/event?x=1",
    "/session",
    "/session/",
    "/session/a/b",
    "/session/../global/event",
    "/session/a%2Fb",
    "/session/a b",
    "//global/event",
    "/session/abc/message",
    "/doc",
  ])("refuses %s", (path) => expect(isAllowedPath(path)).toBe(false));
});

describe("makeGet", () => {
  test("never calls fetch for a path off the allowlist", () => {
    const fetchSpy = vi.fn();
    const get = makeGet(
      fetchSpy,
      "http://127.0.0.1:1",
      new AbortController().signal,
    );
    expect(() => get("/admin")).toThrow(/not on the allowlist/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("always sends redirect: error, the abort signal, and a GET", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}"));
    const controller = new AbortController();
    const get = makeGet(fetchSpy, "http://127.0.0.1:1", controller.signal);
    await get("/session/ses_a");
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:1/session/ses_a");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBe(controller.signal);
    expect(init.method ?? "GET").toBe("GET");
  });
});
