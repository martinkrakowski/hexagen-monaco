// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";

describe.each(BACKENDS)("audit-log store (%s)", (kind) => {
  it("append then countFor counts by action and subject only", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const audit = store.audit;

      await audit.append({
        actorId: "actor-1",
        action: "team.member.add",
        subjectOwnerId: "org-1",
        subjectId: "team-1",
        granteeType: "user",
        granteeId: "user-1",
      });
      await audit.append({
        actorId: "actor-2",
        action: "team.member.add",
        subjectOwnerId: "org-1",
        subjectId: "team-1",
        granteeType: "user",
        granteeId: "user-2",
      });
      await audit.append({
        actorId: "actor-3",
        action: "team.member.remove",
        subjectOwnerId: "org-1",
        subjectId: "team-1",
      });
      await audit.append({
        actorId: "actor-4",
        action: "team.member.add",
        subjectOwnerId: "org-1",
        subjectId: "team-2",
      });

      assert.equal(await audit.countFor("team.member.add", "team-1"), 2);
      assert.equal(await audit.countFor("team.member.remove", "team-1"), 1);
      assert.equal(await audit.countFor("team.member.add", "team-2"), 1);
    } finally {
      await backend.close();
    }
  });

  it("append with every optional field omitted is accepted (NULL columns)", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const audit = store.audit;
      await audit.append({
        actorId: "actor-1",
        action: "team.create",
      });
      const n = await audit.countFor("team.create", "");
      assert.equal(typeof n, "number");
    } finally {
      await backend.close();
    }
  });
});
