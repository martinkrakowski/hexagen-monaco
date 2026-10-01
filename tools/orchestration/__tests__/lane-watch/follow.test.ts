import { afterEach, describe, expect, test, vi } from "vitest";
import {
  SESSION,
  frame,
  heartbeat,
  idle,
  run,
  sleep,
  sseHead,
  startFake,
  type Fake,
} from "./fixtures.js";

const fakes: Fake[] = [];
afterEach(async () => {
  for (const fake of fakes.splice(0)) await fake.close();
});
const serve = async (handler: Parameters<typeof startFake>[0]) => {
  const fake = await startFake(handler);
  fakes.push(fake);
  return fake;
};
const follow = (fake: Fake, ...more: string[]) =>
  run(["follow", "--server", fake.origin, "--session", SESSION, ...more]);

const toolPart = (status: string, sessionID = SESSION) =>
  frame("message.part.updated", {
    part: { type: "tool", tool: "bash", sessionID, state: { status } },
  });

describe("follow: progress and completion", () => {
  test("streams progress for the session until session.idle, then exits 0", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(heartbeat());
      res.write(
        frame("message.part.updated", {
          part: { type: "step-start", sessionID: SESSION },
        }),
      );
      res.write(toolPart("running"));
      res.write(toolPart("completed"));
      res.write(
        frame("message.part.updated", {
          part: { type: "step-finish", sessionID: SESSION },
        }),
      );
      res.write(idle());
    });
    const result = await follow(fake);
    expect(result.code).toBe(0);
    expect(result.out.join("\n")).toContain("tool bash running");
    expect(result.out.join("\n")).toContain("tool bash completed");
    expect(result.out.join("\n")).toContain("step start");
    expect(result.out.join("\n")).toContain("step finish");
    expect(result.out.at(-1)).toBe("done");
    expect(fake.requests).toEqual(["/global/event"]);
  });

  test("session.status with status.type idle is also done", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(
        frame("session.status", {
          sessionID: SESSION,
          status: { type: "busy" },
        }),
      );
      res.write(
        frame("session.status", {
          sessionID: SESSION,
          status: { type: "idle" },
        }),
      );
    });
    const result = await follow(fake);
    expect(result.code).toBe(0);
    expect(result.out.at(-1)).toBe("done");
  });

  test("events for another session are ignored, including its idle", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(idle("ses_other"));
      res.write(toolPart("running", "ses_other"));
      res.write(idle());
    });
    const result = await follow(fake);
    expect(result.code).toBe(0);
    expect(result.out.join("\n")).not.toContain("tool bash");
  });

  test("the session id is read from properties.sessionID too", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(
        frame("message.part.updated", {
          sessionID: SESSION,
          part: { type: "step-start" },
        }),
      );
      res.write(idle());
    });
    expect((await follow(fake)).out.join("\n")).toContain("step start");
  });

  test("message.part.delta is not progress", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(
        frame("message.part.delta", { sessionID: SESSION, delta: "tok" }),
      );
      res.write(idle());
    });
    const result = await follow(fake);
    expect(result.out).toEqual(["done"]);
  });

  test("control bytes in a tool name never reach the terminal", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(
        frame("message.part.updated", {
          part: {
            type: "tool",
            tool: "ba\u001b[2Jsh",
            sessionID: SESSION,
            state: { status: "running" },
          },
        }),
      );
      res.write(idle());
    });
    const text = (await follow(fake)).out.join("\n");
    expect(text).not.toContain("\u001b");
  });

  test("a stream that ends before idle is an error, exit 1", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(heartbeat());
      res.end();
    });
    const result = await follow(fake);
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("ended");
  });

  test("a non-200 answer is an error, exit 1", async () => {
    const fake = await serve((_req, res) => {
      res.writeHead(500).end("no");
    });
    expect((await follow(fake)).code).toBe(1);
  });
});

describe("follow: exits on the concluding frame itself", () => {
  test("session.idle ends the run without another read, while the socket stays open", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(idle());
      // Nothing more is ever written and the response is never ended.
    });
    const started = Date.now();
    const result = await follow(fake, "--stall-seconds", "30");
    expect(result.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(3000);
    // And it aborted: the server sees its response closed.
    await Promise.race([
      Promise.all(fake.closed),
      sleep(3000).then(() => {
        throw new Error("the connection was left open");
      }),
    ]);
  });

  test("an idle that shares a chunk with later frames still ends the run at the idle", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(idle() + toolPart("running"));
    });
    const result = await follow(fake);
    expect(result.code).toBe(0);
    expect(result.out.join("\n")).not.toContain("tool bash");
  });
});

describe("follow: the stall timer, over a real socket", () => {
  // The other stall rules are asserted on a fake clock in follow-timers.test.ts;
  // this is the one test that runs real time against a real loopback socket.
  test("loopback integration check: heartbeats do not reset the stall timer, and the stall aborts the connection", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      const timer = setInterval(() => res.write(heartbeat()), 20);
      res.on("close", () => clearInterval(timer));
    });
    const result = await follow(fake, "--stall-seconds", "0.3");
    expect(result.code).toBe(4);
    expect(result.err.join("\n")).toMatch(/stall/i);
    await Promise.race([
      Promise.all(fake.closed),
      sleep(10_000).then(() => {
        throw new Error("the connection was left open");
      }),
    ]);
  });
});

describe("follow: safety", () => {
  test("a redirect is an error and is never followed", async () => {
    const fake = await serve((req, res) => {
      if (req.url === "/global/event") {
        res.writeHead(302, { location: "/elsewhere" }).end();
      } else {
        res.writeHead(200).end("leaked");
      }
    });
    const result = await follow(fake);
    expect(result.code).toBe(1);
    expect(fake.requests).toEqual(["/global/event"]);
  });

  test("every request carries redirect: error and an abort signal that is aborted by exit", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(idle());
    });
    const result = await follow(fake);
    expect(result.fetchCalls).toHaveLength(1);
    const { init } = result.fetchCalls[0]!;
    expect(init.redirect).toBe("error");
    expect(init.signal?.aborted).toBe(true);
  });

  test("the signal is aborted on the error path too", async () => {
    const fake = await serve((_req, res) => {
      res.writeHead(500).end();
    });
    const result = await follow(fake);
    expect(result.fetchCalls[0]!.init.signal?.aborted).toBe(true);
  });

  test("an unterminated line past the cap is refused as an error, not buffered", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write("data: " + "x".repeat(2 * 1024 * 1024));
    });
    const result = await follow(fake);
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toMatch(/too large|exceed/i);
  });

  test("a non-loopback --server exits 2 and calls nothing", async () => {
    const fetchSpy = vi.fn();
    const result = await run(
      ["follow", "--server", "http://example.com:4096", "--session", SESSION],
      { fetch: fetchSpy as unknown as typeof fetch },
    );
    expect(result.code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.err.join("\n")).toContain("LOOPBACK");
  });

  test("a bad --session exits 2 and calls nothing", async () => {
    const fetchSpy = vi.fn();
    const result = await run(
      [
        "follow",
        "--server",
        "http://127.0.0.1:4097",
        "--session",
        "../etc/passwd",
      ],
      { fetch: fetchSpy as unknown as typeof fetch },
    );
    expect(result.code).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("session.error for the session prints a line and does not change done", async () => {
    const fake = await serve((_req, res) => {
      sseHead(res);
      res.write(
        frame("session.error", {
          sessionID: SESSION,
          error: { name: "ProviderAuthError\u001b[2J" },
        }),
      );
      res.write(idle());
    });
    const result = await follow(fake);
    expect(result.code).toBe(0);
    expect(result.out).toContain("error ProviderAuthError?[2J");
  });

  test("an interrupt (external abort) ends the run with 130 and aborts the request", async () => {
    const fake = await serve((_req, res) => sseHead(res));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await run(
      [
        "follow",
        "--server",
        fake.origin,
        "--session",
        SESSION,
        "--stall-seconds",
        "30",
      ],
      { signal: controller.signal },
    );
    expect(result.code).toBe(130);
    expect(result.fetchCalls[0]!.init.signal?.aborted).toBe(true);
  });
});
