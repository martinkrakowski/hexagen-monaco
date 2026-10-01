import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { dispositionMutation } from "../../src/sweep/lib/sweep.js";

/**
 * Offline schema-shape check for the sweep's write mutation.
 *
 * The fixture is a minimal slice of GitHub's public GraphQL schema, taken with
 * an introspection query through `gh api graphql` (its `generatedAt` records the
 * date). Every field the mutation selects is checked against it, so a selection
 * GitHub would reject as a whole document — `addComment { comment }` was one,
 * `AddCommentPayload` has no `comment` field — fails here without a network.
 */
interface Fixture {
  readonly generatedAt: string;
  readonly types: Record<string, Record<string, string | null>>;
  readonly kinds: Record<string, string>;
  readonly mutations: Record<string, string>;
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/github-schema.json", import.meta.url),
    "utf8",
  ),
) as Fixture;

interface Selection {
  readonly name: string;
  readonly children: readonly Selection[];
}

/** The body of the mutation's top-level selection set, as a field tree. */
function parseSelections(document: string): Selection[] {
  const tokens = document
    .replace(/\(([^()]|\([^()]*\))*\)/g, " ") // drop argument lists
    .match(/[A-Za-z_][A-Za-z0-9_]*|[{}:]/g)!;
  let i = tokens.indexOf("{") + 1; // past the operation's own `{`
  const parseSet = (): Selection[] => {
    const out: Selection[] = [];
    while (i < tokens.length && tokens[i] !== "}") {
      let name = tokens[i++]!;
      if (tokens[i] === ":") {
        i++; // `alias: field` — the field is the schema name
        name = tokens[i++]!;
      }
      let children: Selection[] = [];
      if (tokens[i] === "{") {
        i++;
        children = parseSet();
        i++; // the closing `}`
      }
      out.push({ name, children });
    }
    return out;
  };
  return parseSet();
}

/** Every `Type.field` the selections name that the fixture does not define. */
function unknownFields(
  selections: readonly Selection[],
  typeName: string,
): string[] {
  const fields = fixture.types[typeName];
  if (fields === undefined) return [`<type ${typeName} not in fixture>`];
  const bad: string[] = [];
  for (const selection of selections) {
    if (!(selection.name in fields)) {
      bad.push(`${typeName}.${selection.name}`);
      continue;
    }
    const next = fields[selection.name];
    if (typeof next !== "string") continue;
    // The fixture says what each field returns: a composite (OBJECT, INTERFACE,
    // UNION) needs a selection set and a leaf (SCALAR, ENUM) takes none. A bare
    // `thread` or a `commentEdge` with no sub-selection is rejected by GitHub too.
    const composite = ["OBJECT", "INTERFACE", "UNION"].includes(
      fixture.kinds[next] ?? "",
    );
    if (composite && selection.children.length === 0) {
      bad.push(`${typeName}.${selection.name} needs a selection set (${next})`);
    } else if (!composite && selection.children.length > 0) {
      bad.push(
        `${typeName}.${selection.name} is a leaf (${next}) and takes no selection set`,
      );
    } else if (selection.children.length > 0) {
      bad.push(...unknownFields(selection.children, next));
    }
  }
  return bad;
}

describe("dispositionMutation against GitHub's schema", () => {
  test("the fixture is a dated introspection snapshot", () => {
    expect(fixture.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(fixture.types)).toContain("AddCommentPayload");
  });

  test("selects only fields the payload types define", () => {
    const top = parseSelections(dispositionMutation(2));
    const unknown: string[] = [];
    for (const field of top) {
      const payload = fixture.mutations[field.name];
      if (payload === undefined) {
        unknown.push(`Mutation.${field.name}`);
        continue;
      }
      unknown.push(...unknownFields(field.children, payload));
    }
    expect(unknown).toEqual([]);
  });

  test("a composite field with no selection set is rejected", () => {
    const bare = parseSelections(
      "mutation M { resolveReviewThread(input: {}) { thread } }",
    );
    expect(
      unknownFields(bare[0]!.children, "ResolveReviewThreadPayload"),
    ).toEqual([
      "ResolveReviewThreadPayload.thread needs a selection set (PullRequestReviewThread)",
    ]);
    const bareEdge = parseSelections(
      "mutation M { addComment(input: {}) { commentEdge } }",
    );
    expect(unknownFields(bareEdge[0]!.children, "AddCommentPayload")).toEqual([
      "AddCommentPayload.commentEdge needs a selection set (IssueCommentEdge)",
    ]);
  });

  test("a leaf field with a selection set is rejected", () => {
    const leaf = parseSelections(
      "mutation M { resolveReviewThread(input: {}) { thread { id { x } } } }",
    );
    expect(
      unknownFields(leaf[0]!.children, "ResolveReviewThreadPayload"),
    ).toEqual([
      "PullRequestReviewThread.id is a leaf (ID) and takes no selection set",
    ]);
  });

  test("the checker rejects the old `comment { url }` selection", () => {
    const old = parseSelections(
      "mutation M { addComment(input: {}) { comment { url } } }",
    );
    expect(unknownFields(old[0]!.children, "AddCommentPayload")).toEqual([
      "AddCommentPayload.comment",
    ]);
  });
});
