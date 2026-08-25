import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPlatformStore } from "../store";

describe("OrgsRepository.listOrgsForUser", () => {
  it("returns this caller's orgs with roles, and nobody else's", async () => {
    const store = createPlatformStore(":memory:");
    try {
      const acme = await store.orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "user-1",
      });
      const beta = await store.orgs.createOrg({
        slug: "beta",
        name: "Beta",
        createdBy: "user-2",
      });
      await store.orgs.addMember(acme.id, "user-1", "owner");
      await store.orgs.addMember(acme.id, "user-2", "member");
      await store.orgs.addMember(beta.id, "user-2", "owner");

      const forUser1 = await store.orgs.listOrgsForUser("user-1");
      assert.equal(forUser1.length, 1);
      assert.equal(forUser1[0]?.id, acme.id);
      assert.equal(forUser1[0]?.slug, "acme");
      assert.equal(forUser1[0]?.name, "Acme");
      assert.equal(forUser1[0]?.role, "owner");

      const forUser2 = await store.orgs.listOrgsForUser("user-2");
      assert.equal(forUser2.length, 2);
      const bySlug = Object.fromEntries(forUser2.map((o) => [o.slug, o.role]));
      assert.equal(bySlug.acme, "member");
      assert.equal(bySlug.beta, "owner");

      const forStranger = await store.orgs.listOrgsForUser("nobody");
      assert.equal(forStranger.length, 0);
    } finally {
      store.close();
    }
  });
});
