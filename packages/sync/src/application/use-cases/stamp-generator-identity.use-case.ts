import yaml from "js-yaml";
import { HEXAGEN_GENERATOR_NAME } from "@hexagen/project-configuration";
import type { DeepEqual } from "./migrate-manifest.use-case.js";

export interface StampGeneratorIdentityResult {
  content: string; // byte-identical to the input when changed is false
  changed: boolean;
}

export class StampGeneratorIdentityUseCase {
  constructor(private readonly deepEqual: DeepEqual) {}

  execute(content: string): StampGeneratorIdentityResult {
    const parsedRaw = yaml.load(content);
    if (
      parsedRaw === null ||
      typeof parsedRaw !== "object" ||
      Array.isArray(parsedRaw)
    ) {
      throw new Error(
        "File root must be a YAML mapping — cannot stamp generator.name.",
      );
    }
    const parsed = parsedRaw as Record<string, unknown>;
    const gen = parsed.generator as Record<string, unknown> | undefined;

    if (
      gen !== undefined &&
      (gen === null || typeof gen !== "object" || Array.isArray(gen))
    ) {
      throw new Error(
        "`generator` must be a mapping — cannot stamp generator.name.",
      );
    }

    const name = gen?.name;
    if (name === HEXAGEN_GENERATOR_NAME) {
      return { content, changed: false };
    }
    if (name !== undefined) {
      throw new Error(
        `generator.name is already set to ${String(name)}, not ${HEXAGEN_GENERATOR_NAME} — refusing to overwrite another generator's identity.`,
      );
    }

    const refusal =
      "Could not stamp generator.name without altering the file (unsupported YAML layout). " +
      'Add `name: "@hexagen-monaco/sync"` under `generator:` by hand.';

    if (gen === undefined) {
      const quoted = JSON.stringify(HEXAGEN_GENERATOR_NAME);
      const base = content.endsWith("\n") ? content : content + "\n";
      const result = base + "generator:\n  name: " + quoted + "\n";
      this.assertStampedOnlyAdded(result, parsed, gen);
      return { content: result, changed: true };
    }

    const lines = content.split("\n");
    const idx = lines.findIndex((l) => /^generator:[ \t]*(#.*)?$/.test(l));
    if (idx === -1) {
      throw new Error(refusal);
    }

    let indent = "  ";
    for (let i = idx + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      const match = /^[ \t]*/.exec(line);
      if (match && match[0].length > 0) indent = match[0];
      break;
    }

    lines.splice(
      idx + 1,
      0,
      indent + "name: " + JSON.stringify(HEXAGEN_GENERATOR_NAME),
    );
    const result = lines.join("\n");
    this.assertStampedOnlyAdded(result, parsed, gen);
    return { content: result, changed: true };
  }

  private assertStampedOnlyAdded(
    result: string,
    parsed: Record<string, unknown>,
    gen: Record<string, unknown> | undefined,
  ): void {
    let clean = false;
    try {
      const reparsed = yaml.load(result);
      clean = this.deepEqual(reparsed, {
        ...parsed,
        generator: {
          ...(gen ?? {}),
          name: HEXAGEN_GENERATOR_NAME,
        },
      });
    } catch {
      clean = false;
    }
    if (!clean) {
      throw new Error(
        "Could not stamp generator.name without altering the file (unsupported YAML layout). " +
          'Add `name: "@hexagen-monaco/sync"` under `generator:` by hand.',
      );
    }
  }
}
