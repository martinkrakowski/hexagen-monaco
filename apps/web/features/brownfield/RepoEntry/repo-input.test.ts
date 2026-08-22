import { describe, it, expect } from "vitest";

import {
  describeSubmitBlocker,
  readRepoInput,
  suggestProjectName,
  toRepoReference,
} from "./repo-input";

/**
 * The client-side reading of the repository box (BF-5.3).
 *
 * The thing these tests are careful about is the DIRECTION of the errors. This
 * module is advisory — `app/lib/project-scan/clone.ts` is the trust boundary —
 * so a false accept costs one request that returns better copy than this file
 * could write, while a false reject is a repository the product refuses to scan
 * for no reason. The "accepts" block is therefore the important half, and it
 * deliberately includes shapes the server's stricter grammar might still turn
 * down.
 */

describe("readRepoInput", () => {
  it("accepts the shapes a user will actually paste", () => {
    for (const input of [
      "acme/checkout-service",
      "  acme/checkout-service  ",
      "https://github.com/acme/checkout-service",
      "https://www.github.com/acme/checkout-service",
      "https://github.com/acme/checkout-service/",
      "https://github.com/acme/checkout-service.git",
      "acme/checkout-service.git",
      // GitHub's own address bar, deep-linked into a branch. Telling someone
      // their correct URL is wrong is worse than reading the first two
      // segments out of it.
      "https://github.com/acme/checkout-service/tree/main/packages/orders",
      // The scheme-less paste, which is what the browser address bar hands you.
      "github.com/acme/checkout-service",
      "www.github.com/acme/checkout-service",
    ]) {
      const read = readRepoInput(input);
      expect(read.verdict, input).toBe("usable");
      expect(read.owner).toBe("acme");
      expect(read.repo).toBe("checkout-service");
      expect(read.advisory).toBeNull();
    }
  });

  it("refuses only what a round trip could not fix", () => {
    expect(readRepoInput("").verdict).toBe("empty");
    expect(readRepoInput("   ").verdict).toBe("empty");
    expect(readRepoInput("acme").verdict).toBe("unparsed");
    expect(readRepoInput("just some text").verdict).toBe("unparsed");
    expect(readRepoInput("https://github.com/acme").verdict).toBe("unparsed");
    expect(readRepoInput("h ttp://[").verdict).toBe("unparsed");
  });

  it("rejects a non-github host by EXACT match, never by suffix", () => {
    for (const input of [
      "https://gitlab.com/acme/checkout",
      "https://evilgithub.com/acme/checkout",
      "https://github.com.evil.tld/acme/checkout",
      // Userinfo smuggling: the host is `evil.tld`, and even if it were not,
      // credentials in the box are refused outright.
      "https://github.com@evil.tld/acme/checkout",
      "https://user:pass@github.com/acme/checkout",
      // The SSH form the route rejects outright, so there is no point sending it.
      "git@github.com:acme/checkout.git",
      // Scheme-less, from another host. A GitHub account name can never
      // contain a dot, so a dotted first segment is a hostname.
      "gitlab.com/acme/checkout",
    ]) {
      const read = readRepoInput(input);
      expect(read.verdict, input).toBe("not-github");
      expect(read.advisory).toMatch(/github\.com/);
    }
  });

  it("refuses a pasted megabyte before parsing it", () => {
    expect(readRepoInput(`a/${"b".repeat(4000)}`).verdict).toBe("unparsed");
  });

  it("has an advisory for every unusable verdict and none for a usable one", () => {
    expect(readRepoInput("acme/checkout").advisory).toBeNull();
    expect(readRepoInput("").advisory).toBeNull();
    expect(readRepoInput("nope").advisory).not.toBeNull();
    expect(readRepoInput("https://gitlab.com/a/b").advisory).not.toBeNull();
  });
});

describe("toRepoReference", () => {
  it("normalises to the `owner/repo` shorthand the route parses", () => {
    expect(toRepoReference("https://github.com/acme/checkout.git/")).toBe(
      "acme/checkout",
    );
    expect(toRepoReference("github.com/acme/checkout")).toBe("acme/checkout");
    expect(toRepoReference("gitlab.com/acme/checkout")).toBeNull();
    expect(toRepoReference("https://gitlab.com/acme/checkout")).toBeNull();
    expect(toRepoReference("")).toBeNull();
  });
});

describe("suggestProjectName", () => {
  it("suggests the repository name, clamped to the route's own limit", () => {
    expect(suggestProjectName("acme/checkout-service")).toBe(
      "checkout-service",
    );
    expect(suggestProjectName("https://github.com/acme/my.repo.git")).toBe(
      "my.repo",
    );
    expect(suggestProjectName("nope")).toBe("");
    expect(suggestProjectName(`acme/${"x".repeat(150)}`)).toHaveLength(100);
  });
});

describe("describeSubmitBlocker", () => {
  it("names the reason instead of leaving a disabled button unexplained", () => {
    expect(describeSubmitBlocker("", "proj")).toBe(
      "Enter a repository to scan.",
    );
    expect(describeSubmitBlocker("nope", "proj")).toMatch(/owner\/repo/);
    expect(describeSubmitBlocker("acme/checkout", "   ")).toBe(
      "Give the project a name.",
    );
    expect(describeSubmitBlocker("acme/checkout", "x".repeat(101))).toMatch(
      /100 characters or fewer/,
    );
  });

  it("is null when the form is submittable", () => {
    expect(describeSubmitBlocker("acme/checkout", "checkout")).toBeNull();
    expect(
      describeSubmitBlocker("https://github.com/acme/checkout", "checkout"),
    ).toBeNull();
  });
});
