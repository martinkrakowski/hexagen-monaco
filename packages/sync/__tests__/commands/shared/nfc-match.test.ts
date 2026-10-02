import { describe, it, expect } from "vitest";
import {
  sliceEntryOf,
  targetInSlice,
  underPrefix,
} from "../../../src/commands/shared/brownfield-sidecar.js";

const nfc = "src/café/";
const nfd = "src/café/";

describe("brownfield matchers are Unicode-form blind", () => {
  it("underPrefix matches an entry and a candidate in either form", () => {
    for (const entry of [nfc, nfd]) {
      for (const candidate of [`${nfc}x.ts`, `${nfd}x.ts`]) {
        expect(underPrefix(entry, candidate)).toBe(true);
      }
    }
    expect(underPrefix(`${nfd}x.ts`, `${nfc}x.ts`)).toBe(true);
  });

  it("excludes bite whichever form either side uses", () => {
    for (const exclude of [nfc, nfd]) {
      const slice = { paths: ["src/"], excludes: [exclude] };
      for (const to of [`${nfc}x.ts`, `${nfd}x.ts`]) {
        expect(targetInSlice(slice, to)).toBe(false);
        expect(sliceEntryOf(slice, to)).toBeUndefined();
      }
    }
  });
});
