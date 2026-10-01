import { afterEach, describe, expect, test, vi } from "vitest";
import { SESSION, run, startFake, type Fake } from "./fixtures.js";

const fakes: Fake[] = [];
afterEach(async () => {
  for (const fake of fakes.splice(0)) await fake.close();
});

const sessionJson = (body: unknown, status = 200) =>
  startFake((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  }).then((fake) => {
    fakes.push(fake);
    return fake;
  });

const usage = (fake: Fake) =>
  run(["usage", "--server", fake.origin, "--session", SESSION]);

const FULL = {
  id: SESSION,
  time: { created: 1_000, updated: 13_500 },
  cost: 0.25,
  tokens: {
    input: 100,
    output: 40,
    reasoning: 5,
    cache: { read: 7, write: 3 },
  },
};

describe("usage", () => {
  test("a complete reading prints seconds, tokens and cost and exits 0", async () => {
    const fake = await sessionJson(FULL);
    const result = await usage(fake);
    expect(result.code).toBe(0);
    const text = result.out.join("\n");
    expect(text).toContain("secs: 12.5");
    expect(text).toContain("tokens: input=100 output=40");
    expect(text).toContain("cost: 0.25");
    expect(text).not.toContain("unknown");
    expect(fake.requests).toEqual([`/session/${SESSION}`]);
  });

  test.each([
    ["cost is null", { ...FULL, cost: null }, "cost: unknown"],
    ["cost is absent", { ...FULL, cost: undefined }, "cost: unknown"],
    ["tokens is null", { ...FULL, tokens: null }, "tokens: unknown"],
    ["tokens is absent", { ...FULL, tokens: undefined }, "tokens: unknown"],
    [
      "tokens is partial (no output)",
      { ...FULL, tokens: { input: 1 } },
      "tokens: unknown",
    ],
    ["time is absent", { ...FULL, time: undefined }, "secs: unknown"],
    [
      "time.updated is null",
      { ...FULL, time: { created: 1, updated: null } },
      "secs: unknown",
    ],
    [
      "time runs backwards",
      { ...FULL, time: { created: 9, updated: 1 } },
      "secs: unknown",
    ],
    [
      "a token count is negative",
      { ...FULL, tokens: { input: -1, output: 2 } },
      "tokens: unknown",
    ],
    [
      "a token count is a string",
      { ...FULL, tokens: { input: "1", output: 2 } },
      "tokens: unknown",
    ],
  ])(
    "%s: prints unknown and exits 3, never 0",
    async (_name, body, expected) => {
      const result = await usage(await sessionJson(body));
      expect(result.code).toBe(3);
      expect(result.out.join("\n")).toContain(expected);
    },
  );

  test("a reading with nothing at all is unknown on every field and exits 3", async () => {
    const result = await usage(await sessionJson({ id: SESSION }));
    expect(result.code).toBe(3);
    const text = result.out.join("\n");
    expect(text).toContain("secs: unknown");
    expect(text).toContain("tokens: unknown");
    expect(text).toContain("cost: unknown");
  });

  test("a partial reading still prints the fields it has", async () => {
    const result = await usage(await sessionJson({ ...FULL, cost: null }));
    expect(result.out.join("\n")).toContain("secs: 12.5");
  });

  test("a 404 is an error, exit 1, and says so", async () => {
    const result = await usage(await sessionJson({ error: "nope" }, 404));
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("404");
  });

  test("an unparseable body is an error, exit 1", async () => {
    expect((await usage(await sessionJson("<html>"))).code).toBe(1);
  });

  test("a body that is not an object is an error, exit 1", async () => {
    expect((await usage(await sessionJson("[1,2]"))).code).toBe(1);
  });

  test("an oversized body is refused, exit 1", async () => {
    const big = JSON.stringify({ ...FULL, pad: "x".repeat(2 * 1024 * 1024) });
    expect((await usage(await sessionJson(big))).code).toBe(1);
  });

  test("a redirect is an error and is never followed", async () => {
    const fake = await startFake((req, res) => {
      if (req.url === `/session/${SESSION}`) {
        res.writeHead(307, { location: "/other" }).end();
      } else res.writeHead(200).end("{}");
    });
    fakes.push(fake);
    expect((await usage(fake)).code).toBe(1);
    expect(fake.requests).toEqual([`/session/${SESSION}`]);
  });

  test("the request carries redirect: error, and its signal is aborted on exit", async () => {
    const result = await usage(await sessionJson(FULL));
    const { init } = result.fetchCalls[0]!;
    expect(init.redirect).toBe("error");
    expect(init.signal?.aborted).toBe(true);
  });

  test("a non-loopback --server exits 2 and calls nothing", async () => {
    const fetchSpy = vi.fn();
    const result = await run(
      ["usage", "--server", "http://10.0.0.5:4096", "--session", SESSION],
      { fetch: fetchSpy as unknown as typeof fetch },
    );
    expect(result.code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an interrupt (external abort) ends usage with 130 and aborts the request", async () => {
    const fake = await startFake(() => {
      // never answers
    });
    fakes.push(fake);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await run(
      ["usage", "--server", fake.origin, "--session", SESSION],
      { signal: controller.signal },
    );
    expect(result.code).toBe(130);
    expect(result.fetchCalls[0]!.init.signal?.aborted).toBe(true);
  });

  test("a connection refused is an error, exit 1, not 3", async () => {
    const result = await run([
      "usage",
      "--server",
      "http://127.0.0.1:1",
      "--session",
      SESSION,
    ]);
    expect(result.code).toBe(1);
  });
});

describe("usage: the record must be the session asked for", () => {
  test("a complete record carrying another id is refused, naming both", async () => {
    const result = await usage(
      await sessionJson({ ...FULL, id: "ses_someone_else" }),
    );
    expect(result.code).toBe(1);
    const text = result.err.join("\n");
    expect(text).toContain(SESSION);
    expect(text).toContain("ses_someone_else");
    expect(result.out).toEqual([]);
  });

  test("a record with no id is refused too", async () => {
    const result = await usage(await sessionJson({ ...FULL, id: undefined }));
    expect(result.code).toBe(1);
  });
});

describe("usage: the deadline", () => {
  test("an unanswered request reads as a timeout, exit 1, not as an abort", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const never: typeof fetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              new DOMException("This operation was aborted", "AbortError"),
            ),
          );
        });
      const pending = run(
        ["usage", "--server", "http://127.0.0.1:4097", "--session", SESSION],
        { fetch: never },
      );
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await pending;
      expect(result.code).toBe(1);
      expect(result.err.join("\n")).toContain(
        "timeout: server did not answer within 30 s",
      );
      expect(result.err.join("\n")).not.toContain("aborted");
    } finally {
      vi.useRealTimers();
    }
  });
});
