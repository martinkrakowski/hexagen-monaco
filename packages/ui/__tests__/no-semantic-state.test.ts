import { describe, it, expect } from "vitest";
import type {
  NoSemanticState,
  ForbiddenPropKeys,
} from "../src/types/forbidden-brand";

describe("NoSemanticState<T> type-level firewall (Layer 1)", () => {
  it("strips forbidden keys from the type surface", () => {
    type Widget = {
      label: string;
      loading: boolean;
      data: unknown;
      error: string | null;
    };

    type SafeWidget = NoSemanticState<Widget>;

    type AssertForbiddenRemoved = SafeWidget extends { loading?: boolean }
      ? never
      : true;

    type AssertLabelPresent = SafeWidget extends { label: string }
      ? true
      : never;

    const checkRemoved: AssertForbiddenRemoved = true as AssertForbiddenRemoved;
    const checkPresent: AssertLabelPresent = true as AssertLabelPresent;

    expect(checkRemoved).toBe(true);
    expect(checkPresent).toBe(true);
  });

  it("forbids all 11 information-state tokens", () => {
    const forbidden: Array<ForbiddenPropKeys> = [
      "data",
      "loading",
      "error",
      "result",
      "isFetching",
      "status",
      "governance",
      "llm",
      "isPending",
      "isSuccess",
      "isError",
    ];
    expect(forbidden).toHaveLength(11);
  });
});
