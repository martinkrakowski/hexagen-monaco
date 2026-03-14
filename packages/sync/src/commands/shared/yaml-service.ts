import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  existsSync,
} from "fs";
import { dirname } from "path";
import yaml from "js-yaml";
import type { Manifest } from "@hexagen/sync";
import { Result, ok, err } from "../../domain/result.js";

export class YamlLoadError extends Error {
  constructor(
    message: string,
    public filePath?: string,
  ) {
    super(message);
    this.name = "YamlLoadError";
  }
}

export class YamlParseError extends Error {
  constructor(
    message: string,
    public line?: number,
    public context?: string,
  ) {
    super(message);
    this.name = "YamlParseError";
  }
}

export class YamlSaveError extends Error {
  constructor(
    message: string,
    public filePath?: string,
  ) {
    super(message);
    this.name = "YamlSaveError";
  }
}

export class YamlService {
  loadManifest(path: string): Result<Manifest, YamlLoadError> {
    try {
      if (!existsSync(path)) {
        return err(new YamlLoadError(`File not found: ${path}`, path));
      }
      const content = readFileSync(path, "utf-8");
      const manifest = yaml.load(content) as Manifest;
      return ok(manifest);
    } catch (e) {
      const error = e as Error;
      return err(new YamlLoadError(error.message, path));
    }
  }

  saveManifest(manifest: Manifest, path: string): Result<void, YamlSaveError> {
    const dir = dirname(path);
    const tempPath = `${path}.tmp`;

    try {
      mkdirSync(dir, { recursive: true });
      const content = yaml.dump(manifest, { indent: 2 });
      writeFileSync(tempPath, content, "utf-8");
      renameSync(tempPath, path);
      return ok(undefined);
    } catch (e) {
      const error = e as Error;
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      return err(new YamlSaveError(error.message, path));
    }
  }

  parse(content: string): Result<Manifest, YamlParseError> {
    try {
      const manifest = yaml.load(content) as Manifest;
      return ok(manifest);
    } catch (e) {
      const error = e as yaml.YAMLException;
      return err(
        new YamlParseError(error.message, error.mark?.line, error.mark?.name),
      );
    }
  }

  serialize(manifest: Manifest): string {
    return yaml.dump(manifest, { indent: 2 });
  }
}

export const yamlService = new YamlService();
