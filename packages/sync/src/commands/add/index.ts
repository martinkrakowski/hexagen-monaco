/* eslint-disable no-console */
import {
  FileSystemTemplateRegistry,
  InteractiveQuestionEngine,
  FileSystemFileEmitter,
  FileSystemTemplateConfigStore,
  AddTemplateUseCase,
  CyclicDependencyError,
  MissingTemplateError,
  ConflictError,
} from "@hexagen/template-engine";
import {
  getProjectRoot,
  confirm,
  resolveTemplatesDir,
} from "../shared/index.js";

export interface AddCommandOptions {
  /** Skip re-applying already-installed templates */
  force?: boolean;
  /** Pre-supplied answers in "key=value" format, per template: templateId.questionId=value */
  answers?: string[];
  /**
   * Also emit each template's `*.test.*` / `*.spec.*` scaffolds. Off by default
   * — matches the web (in-memory) emit path, so `hexagen add` doesn't drop test
   * files (which import the project's test runner) into a project unasked.
   */
  withTests?: boolean;
}

export async function addTemplateCommand(
  templateIds: string[],
  options: AddCommandOptions = {},
): Promise<void> {
  if (templateIds.length === 0) {
    console.error("❌ Usage: hexagen add <template-id> [<template-id> ...]");
    process.exit(1);
  }

  const projectRoot = getProjectRoot();

  const templatesDir = resolveTemplatesDir();
  const registry = new FileSystemTemplateRegistry(templatesDir);
  const questionEngine = new InteractiveQuestionEngine();
  const fileEmitter = new FileSystemFileEmitter(templatesDir, {
    withTests: options.withTests ?? false,
  });
  const configStore = new FileSystemTemplateConfigStore();

  let skipInstalled = !options.force;

  // Check installed templates and warn about re-applies
  if (!options.force) {
    const config = await configStore.load(projectRoot);
    const alreadyInstalled = templateIds.filter((id) => id in config.templates);
    if (alreadyInstalled.length > 0) {
      console.log(`\nAlready installed: ${alreadyInstalled.join(", ")}`);
      const proceed = await confirm("Re-apply? (will skip unless --force)", {
        default: false,
      });
      if (proceed) {
        skipInstalled = false;
      } else {
        console.log(
          "Skipping already-installed templates. Use --force to re-apply.",
        );
        const fresh = templateIds.filter((id) => !(id in config.templates));
        if (fresh.length === 0) {
          process.exit(0);
        }
        templateIds = fresh;
      }
    }
  }

  const useCase = new AddTemplateUseCase(
    registry,
    questionEngine,
    fileEmitter,
    configStore,
  );

  try {
    const result = await useCase.execute({
      templateIds,
      projectRoot,
      skipInstalled,
    });

    if (result.warnings.length > 0) {
      console.log("\n⚠️  Warnings:");
      result.warnings.forEach((w) => console.log(`\n${w}`));
    }

    if (result.applied.length > 0) {
      console.log(`\n✅ Applied: ${result.applied.join(", ")}`);
    }
    if (result.skipped.length > 0) {
      console.log(
        `   Skipped (already installed): ${result.skipped.join(", ")}`,
      );
    }
  } catch (err) {
    if (err instanceof MissingTemplateError) {
      console.error(`\n❌ ${err.message}`);
      console.error(
        "   Run: hexagen templates list  to see available templates",
      );
    } else if (err instanceof CyclicDependencyError) {
      console.error(`\n❌ ${err.message}`);
    } else if (err instanceof ConflictError) {
      console.error(`\n❌ ${err.message}`);
    } else {
      console.error("\n❌ Unexpected error:", err);
    }
    process.exit(1);
  } finally {
    questionEngine.close();
  }
}
