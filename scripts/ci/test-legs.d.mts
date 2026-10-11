export interface TestLegWorkspace {
  name: string;
  dir: string;
  hasTest: boolean;
}

export interface TestLeg {
  leg: string;
  packages: string[];
}

export function computeLegs(
  workspaces: TestLegWorkspace[],
  namedLegs: Record<string, string[]>,
): { legs: TestLeg[]; errors: string[] };

export function toMatrix(
  legs: TestLeg[],
  shardedLegs?: Record<string, number>,
): { include: { leg: string; filters: string; args: string }[] };
