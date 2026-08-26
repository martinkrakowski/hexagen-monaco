// P-U5: the module-level active-tenant store. Module state persists across
// tests in one file, so every test that needs a clean slate re-imports the
// module via vi.resetModules() + dynamic import.
import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";

const STORAGE_KEY = "hexagen-active-tenant";

async function freshStore() {
  vi.resetModules();
  return import("./active-tenant");
}

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
});

describe("active-tenant store", () => {
  it("defaults to personal (null) and round-trips set/get", async () => {
    window.localStorage.removeItem(STORAGE_KEY);
    const store = await freshStore();
    assert.equal(store.getActiveTenantId(), null);

    store.setActiveTenantId("org-1");
    assert.equal(store.getActiveTenantId(), "org-1");

    store.setActiveTenantId(null);
    assert.equal(store.getActiveTenantId(), null);
  });

  it("notifies subscribers on change, not on a no-op set, and stops after unsubscribe", async () => {
    const store = await freshStore();
    let calls = 0;
    const unsubscribe = store.subscribeActiveTenant(() => {
      calls += 1;
    });

    store.setActiveTenantId("org-1");
    assert.equal(calls, 1);

    // Setting the SAME value must not notify — useSyncExternalStore consumers
    // would re-render for nothing.
    store.setActiveTenantId("org-1");
    assert.equal(calls, 1);

    unsubscribe();
    store.setActiveTenantId(null);
    assert.equal(calls, 1);
  });

  it("persists the selection and restores it on a fresh module load", async () => {
    const first = await freshStore();
    first.setActiveTenantId("org-persisted");
    assert.equal(window.localStorage.getItem(STORAGE_KEY), "org-persisted");

    // Simulate a page reload: a brand-new module instance reads storage.
    const second = await freshStore();
    assert.equal(second.getActiveTenantId(), "org-persisted");

    second.setActiveTenantId(null);
    assert.equal(window.localStorage.getItem(STORAGE_KEY), null);
  });

  it("storage that throws on read defaults to personal instead of crashing — and warns (PR #666)", async () => {
    const getItem = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("private window");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const store = await freshStore();
      assert.equal(store.getActiveTenantId(), null);
      assert.ok(
        warn.mock.calls.some((call) =>
          String(call[0]).includes("reading the persisted tenant selection"),
        ),
        "the swallowed read failure must be warned about",
      );
    } finally {
      getItem.mockRestore();
      warn.mockRestore();
    }
  });

  it("storage that throws on write still switches in memory, still notifies — and warns (PR #666)", async () => {
    const store = await freshStore();
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let calls = 0;
      store.subscribeActiveTenant(() => {
        calls += 1;
      });
      store.setActiveTenantId("org-ephemeral");
      assert.equal(store.getActiveTenantId(), "org-ephemeral");
      assert.equal(calls, 1);
      assert.ok(
        warn.mock.calls.some((call) =>
          String(call[0]).includes("persisting the tenant selection"),
        ),
        "the swallowed write failure must be warned about",
      );
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
      store.setActiveTenantId(null);
    }
  });
});
