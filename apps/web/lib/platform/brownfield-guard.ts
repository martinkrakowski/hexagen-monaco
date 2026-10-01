import { NextRequest, NextResponse } from "next/server";
import { projectMode } from "@hexagen/shared";
import { requirePersistenceOwner } from "./require-owner";
import { getPlatformStore } from "./store";

/**
 * BW-D7. The greenfield accept, push and generate routes write the server's
 * own monorepo or a user's GitHub repo, never a client checkout, so a
 * brownfield workbook must not reach them.
 *
 * Each route accepts an OPTIONAL `projectId` in its JSON body and calls this
 * after parsing. The mode is ALWAYS read from the stored project, resolved
 * through the caller's own owner-scoped store; a mode sent by the client is
 * never read.
 *
 *   no id                      → null (route proceeds, behaviour unchanged;
 *                                unsigned IndexedDB projects have no row)
 *   id, caller not signed in   → 401 unauthorized (requirePersistenceOwner)
 *   id, malformed / unknown /
 *   not the caller's own       → 403 forbidden (the same body as the project
 *                                routes, and indistinguishable between
 *                                "missing" and "someone else's": D-A4)
 *   id, stored brownfield      → 409 { error: "brownfield_mode" }
 *   id, stored greenfield      → null (route proceeds)
 */
export async function guardBrownfieldProject(
  request: NextRequest,
  projectId: unknown,
): Promise<NextResponse | null> {
  if (projectId === undefined || projectId === null) return null;

  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  if (typeof projectId !== "string" || projectId.trim() === "") {
    return forbidden();
  }

  const found = getPlatformStore()
    .projectsFor(owner.ownerId)
    .getProject(projectId.trim());
  if (!found.success) {
    return NextResponse.json(
      {
        error: "persistence",
        message: found.error.message,
        statusCode: 500,
      },
      { status: 500 },
    );
  }
  if (found.value === null) return forbidden();

  if (projectMode(found.value) === "brownfield") {
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
