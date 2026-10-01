import { NextRequest, NextResponse } from "next/server";
import { projectMode, type SavedProject } from "@hexagen/shared";
import { requirePersistenceOwner, resolveProjectAccess } from "./require-owner";
import { getPlatformStore } from "./store";

/**
 * BW-D7. The greenfield accept, push and generate routes write the server's
 * own monorepo or a user's GitHub repo, never a client checkout, so a
 * brownfield workbook must not reach them.
 *
 * Each route accepts an OPTIONAL `projectId` in its JSON body and calls this
 * after parsing. The mode is ALWAYS read from the stored project; a mode sent
 * by the client is never read.
 *
 * Resolution covers every tenant the caller can reach, through the existing
 * access helper `resolveProjectAccess` (own tenant, org membership, and live
 * shares/grants from the tenancy work). Candidate owners are: the caller, the
 * caller's orgs, and the owner of every live grant naming this project
 * (`shares.selectSharedWith`, the store method the shared-with-me route uses).
 * Each candidate is then passed through `resolveProjectAccess`, so the
 * authorization decision stays in that one place.
 *
 * Two policies, chosen by the route:
 *
 *  - "strict" (accept, generate: `projectId` is new, no caller sends it yet)
 *      no id                       → null (unchanged)
 *      id, no session sub          → 401
 *      malformed/unknown/
 *      inaccessible id             → 403 (indistinguishable: D-A4)
 *      resolves, brownfield        → 409 { error: "brownfield_mode" }
 *      resolves, greenfield        → null
 *
 *  - "refuse-brownfield-only" (push: its callers ALREADY send the id of
 *      projects that may exist only in IndexedDB or be shared, so this guard
 *      may only ADD a refusal)
 *      no id / no session sub / unknown / inaccessible / greenfield → null
 *      resolves, brownfield        → 409 { error: "brownfield_mode" }
 */
export type BrownfieldGuardPolicy = "strict" | "refuse-brownfield-only";

type Lookup =
  | { kind: "found"; project: SavedProject }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export async function guardBrownfieldProject(
  request: NextRequest,
  projectId: unknown,
  policy: BrownfieldGuardPolicy = "strict",
): Promise<NextResponse | null> {
  if (projectId === undefined || projectId === null) return null;
  const strict = policy === "strict";

  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return strict ? owner.response : null;

  if (typeof projectId !== "string" || projectId.trim() === "") {
    return strict ? forbidden() : null;
  }

  let found: Lookup;
  try {
    found = await lookup(request, owner.ownerId, projectId.trim());
  } catch (e) {
    found = {
      kind: "error",
      message: e instanceof Error ? e.message : "Project lookup failed",
    };
  }
  if (found.kind === "error") {
    return strict
      ? NextResponse.json(
          { error: "persistence", message: found.message, statusCode: 500 },
          { status: 500 },
        )
      : null;
  }
  if (found.kind === "missing") return strict ? forbidden() : null;

  if (projectMode(found.project) === "brownfield") {
    return NextResponse.json(
      {
        error: "brownfield_mode",
        message:
          "This is a brownfield workbook. Accept, push and generate are greenfield-only.",
        statusCode: 409,
      },
      { status: 409 },
    );
  }
  return null;
}

async function lookup(
  request: NextRequest,
  sub: string,
  projectId: string,
): Promise<Lookup> {
  const store = getPlatformStore();
  const [orgIds, teamIds] = await Promise.all([
    store.orgs.listOrgIdsForUser(sub),
    store.teams.listTeamIdsForUser(sub),
  ]);
  const grants = await store.shares.selectSharedWith({
    userId: sub,
    orgIds,
    teamIds,
  });
  const candidates = [
    ...new Set([
      sub,
      ...orgIds,
      ...grants.filter((g) => g.projectId === projectId).map((g) => g.ownerId),
    ]),
  ];

  for (const ownerId of candidates) {
    const access = await resolveProjectAccess(request, ownerId, projectId);
    if (!access.ok) continue;
    const got = store.projectsFor(access.ownerId).getProject(projectId);
    if (!got.success) return { kind: "error", message: got.error.message };
    if (got.value !== null) return { kind: "found", project: got.value };
  }
  return { kind: "missing" };
}

// Same body and status as `projectForbidden` in require-owner.ts.
function forbidden(): NextResponse {
  return NextResponse.json(
    {
      error: "forbidden",
      message: "You do not have access to this project",
      statusCode: 403,
    },
    { status: 403 },
  );
}
