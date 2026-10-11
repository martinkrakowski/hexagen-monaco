import { readFileSync } from "node:fs";

export function plantedDomainReadsDisk(p: string): string {
  return readFileSync(p, "utf8");
}
