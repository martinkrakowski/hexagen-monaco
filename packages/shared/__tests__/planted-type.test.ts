import { it, expect } from "vitest";
const planted: number = "not a number" as unknown as string;
it("planted type error, passes at run time", () => { expect(planted).toBeDefined(); });
