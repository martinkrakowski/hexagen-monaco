import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toProjectListItem, sortItems } from "./project-list.js";
import type { ProjectListItem, SortState } from "./project-list.js";
import type { SavedProject } from "@/hooks/useSavedProjects";

interface MockSavedProject {
  readonly id: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly formState: {
    governance?: { workspaceDescription?: string };
    [key: string]: unknown;
  };
  readonly manifestYaml: string;
}

function makeProject(
  overrides: Partial<MockSavedProject> = {},
): MockSavedProject {
  return {
    id: "proj-1",
    name: "MyProject",
    schemaVersion: 1,
    createdAt: 1000,
    updatedAt: 2000,
    formState: {
      governance: { workspaceDescription: "A test project" },
    },
    manifestYaml: "contexts: []",
    ...overrides,
  };
}

describe("toProjectListItem", () => {
  it("maps all fields correctly from a SavedProject", () => {
    const project = makeProject();
    const result = toProjectListItem(project as unknown as SavedProject);

    assert.strictEqual(result.id, "proj-1");
    assert.strictEqual(result.name, "MyProject");
    assert.strictEqual(result.description, "A test project");
    assert.strictEqual(result.createdAt, 1000);
    assert.strictEqual(result.updatedAt, 2000);
    assert.strictEqual(result.sortName, "myproject");
    assert.strictEqual(result.sortUpdated, 2000);
    assert.strictEqual(result.sortCreated, 1000);
  });

  it("extracts description from formState.governance.workspaceDescription", () => {
    const project = makeProject({
      formState: { governance: { workspaceDescription: "Custom description" } },
    });
    const result = toProjectListItem(project as unknown as SavedProject);
    assert.strictEqual(result.description, "Custom description");
  });

  it("falls back to empty string when governance is missing", () => {
    const project = makeProject({ formState: {} });
    const result = toProjectListItem(project as unknown as SavedProject);
    assert.strictEqual(result.description, "");
  });

  it("falls back to empty string when workspaceDescription is missing", () => {
    const project = makeProject({ formState: { governance: {} } });
    const result = toProjectListItem(project as unknown as SavedProject);
    assert.strictEqual(result.description, "");
  });

  it("lowercases name for sortName", () => {
    const project = makeProject({ name: "CamelCaseName" });
    const result = toProjectListItem(project as unknown as SavedProject);
    assert.strictEqual(result.sortName, "camelcasename");
  });
});

describe("sortItems", () => {
  const items: ProjectListItem[] = [
    {
      id: "a",
      name: "Beta",
      description: "",
      createdAt: 3000,
      updatedAt: 2000,
      sortName: "beta",
      sortUpdated: 2000,
      sortCreated: 3000,
    },
    {
      id: "b",
      name: "Alpha",
      description: "",
      createdAt: 1000,
      updatedAt: 4000,
      sortName: "alpha",
      sortUpdated: 4000,
      sortCreated: 1000,
    },
    {
      id: "c",
      name: "Gamma",
      description: "",
      createdAt: 2000,
      updatedAt: 3000,
      sortName: "gamma",
      sortUpdated: 3000,
      sortCreated: 2000,
    },
  ];

  it("sorts by name ascending", () => {
    const state: SortState = { field: "name", direction: "asc" };
    const result = sortItems(items, state);
    assert.deepStrictEqual(
      result.map((i) => i.id),
      ["b", "a", "c"],
    );
  });

  it("sorts by name descending", () => {
    const state: SortState = { field: "name", direction: "desc" };
    const result = sortItems(items, state);
    assert.deepStrictEqual(
      result.map((i) => i.id),
      ["c", "a", "b"],
    );
  });

  it("sorts by updated ascending", () => {
    const state: SortState = { field: "updated", direction: "asc" };
    const result = sortItems(items, state);
    assert.deepStrictEqual(
      result.map((i) => i.id),
      ["a", "c", "b"],
    );
  });

  it("sorts by updated descending", () => {
    const state: SortState = { field: "updated", direction: "desc" };
    const result = sortItems(items, state);
    assert.deepStrictEqual(
      result.map((i) => i.id),
      ["b", "c", "a"],
    );
  });

  it("sorts by created ascending", () => {
    const state: SortState = { field: "created", direction: "asc" };
    const result = sortItems(items, state);
    assert.deepStrictEqual(
      result.map((i) => i.id),
      ["b", "c", "a"],
    );
  });

  it("sorts by created descending", () => {
    const state: SortState = { field: "created", direction: "desc" };
    const result = sortItems(items, state);
    assert.deepStrictEqual(
      result.map((i) => i.id),
      ["a", "c", "b"],
    );
  });

  it("returns new array without mutating input", () => {
    const state: SortState = { field: "name", direction: "asc" };
    const original = [...items];
    const result = sortItems(items, state);
    assert.notStrictEqual(result, items);
    assert.deepStrictEqual(
      items.map((i) => i.id),
      original.map((i) => i.id),
    );
  });

  it("handles empty array", () => {
    const state: SortState = { field: "name", direction: "asc" };
    const result = sortItems([], state);
    assert.deepStrictEqual(result, []);
  });

  it("handles single item", () => {
    const single: ProjectListItem[] = [items[0]];
    const state: SortState = { field: "name", direction: "asc" };
    const result = sortItems(single, state);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, "a");
  });

  it("handles items with same sort values preserving relative order", () => {
    const tied: ProjectListItem[] = [
      {
        id: "x",
        name: "Same",
        description: "",
        createdAt: 5000,
        updatedAt: 5000,
        sortName: "same",
        sortUpdated: 5000,
        sortCreated: 5000,
      },
      {
        id: "y",
        name: "Same",
        description: "",
        createdAt: 5000,
        updatedAt: 5000,
        sortName: "same",
        sortUpdated: 5000,
        sortCreated: 5000,
      },
    ];
    const state: SortState = { field: "name", direction: "asc" };
    const result = sortItems(tied, state);
    assert.strictEqual(result[0].id, "x");
    assert.strictEqual(result[1].id, "y");
  });
});
