import type { ProvidedContext } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    pgHomeUrl: string;
    pgTemplate: string;
    pgRun: string;
  }
}

export type { ProvidedContext };
