import { NextRequest, NextResponse } from "next/server";
import { projectMode, type SavedProject } from "@hexagen/shared";
import { requirePersistenceOwner } from "./require-owner";
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
 * Resolution covers every tenant the caller can reach. Candidate enumeration
 * IS the authorization: the only owners ever read are
 *   1. the caller's own sub,
 *   2. orgs the caller is a member of (`orgs.listOrgIdsForUser`), and
 *   3. owners of LIVE grants (user, org or team) that name this project
 *      (`shares.selectSharedWith(identity, projectId)`; revoked grants are
 *      excluded by the store, and the query is bounded by the project, not by
 *      how many projects the caller has been shared).
 * A project under any other owner is never looked up, so it reads as unknown.
 * This deliberately does not call `resolveProjectAccess`: it would re-check
 * exactly what the enumeration already established.
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
    found = await lookup(owner.ownerId, projectId.trim());
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

async function lookup(sub: string, projectId: string): Promise<Lookup> {
  const store = getPlatformStore();
  const [orgIds, teamIds] = await Promise.all([
    store.orgs.listOrgIdsForUser(sub),
    store.teams.listTeamIdsForUser(sub),
  ]);
  const grants = await store.shares.selectSharedWith(
    { userId: sub, orgIds, teamIds },
    projectId,
  );
  const candidates = [
    ...new Set([sub, ...orgIds, ...grants.map((g) => g.ownerId)]),
  ];

  for (const ownerId of candidates) {
    const got = store.projectsFor(ownerId).getProject(projectId);
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
