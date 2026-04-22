import { describe, it, expect } from "vitest";
import {
  FORBIDDEN_TOKENS,
  isForbiddenToken,
} from "../src/types/forbidden-brand";

describe("ForbiddenToken helpers", () => {
  it("FORBIDDEN_TOKENS includes all 11 forbidden prop names", () => {
    expect(FORBIDDEN_TOKENS).toHaveLength(11);
    expect(FORBIDDEN_TOKENS).toContain("data");
    expect(FORBIDDEN_TOKENS).toContain("loading");
    expect(FORBIDDEN_TOKENS).toContain("error");
    expect(FORBIDDEN_TOKENS).toContain("result");
    expect(FORBIDDEN_TOKENS).toContain("isFetching");
    expect(FORBIDDEN_TOKENS).toContain("governance");
    expect(FORBIDDEN_TOKENS).toContain("llm");
    expect(FORBIDDEN_TOKENS).toContain("status");
    expect(FORBIDDEN_TOKENS).toContain("isPending");
    expect(FORBIDDEN_TOKENS).toContain("isSuccess");
    expect(FORBIDDEN_TOKENS).toContain("isError");
  });

  it("isForbiddenToken narrows string to ForbiddenToken", () => {
    expect(isForbiddenToken("data")).toBe(true);
    expect(isForbiddenToken("label")).toBe(false);
    expect(isForbiddenToken("variant")).toBe(false);
    expect(isForbiddenToken("onClick")).toBe(false);
  });
});
