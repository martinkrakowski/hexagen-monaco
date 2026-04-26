#!/usr/bin/env node

/**
 * Fix ESM Module Resolution for ALL Compiled Files
 *
 * Problem: TypeScript with "module": "ESNext" compiles import/export statements
 * without adding `.js` extensions. Node.js ESM requires explicit file extensions
 * for all relative imports.
 *
 * Solution: Post-process ALL compiled JS files to add `.js` extensions to ALL
 * relative import paths that are missing them — **resolving directory imports
 * to their `/index.js` when a sibling `.js` does not exist**.
 *
 *   Source (tsc output):        export * from "./domain";
 *   Naive fix (old behavior):   export * from "./domain.js";      ← broken if ./domain.js does not exist
 *   Correct fix (new behavior): export * from "./domain/index.js"; ← when ./domain/index.js exists
 *
 * The rewriter checks filesystem reality at each rewrite site and chooses:
 *   1. `${path}.js`            if file exists on disk
 *   2. `${path}/index.js`      if directory with index.js exists on disk
 *   3. `${path}.js`            as a last-resort fallback (runtime will fail with a
 *                              clear ERR_MODULE_NOT_FOUND if truly missing)
 *
 * Usage: node fix-esm-barrels.js <dist-directory>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a relative import specifier to a concrete on-disk file path.
 *
 * Note: Both `.js` and `.d.ts` files use `.js` specifiers in their imports,
 * per ESM convention. `.d.ts` files are the type companions of `.js` and must
 * reference the `.js` extension even though the on-disk file ends with `.d.ts`.
 * TypeScript's NodeNext resolver pairs them automatically.
 *
 * @param {string} importPath - The specifier from the import statement (e.g., "./domain")
 * @param {string} sourceFile - Absolute path to the file containing the import
 * @returns {string} The resolved specifier (with .js extension) to emit into the output
 */
function resolveExtension(importPath, sourceFile) {
  const dir = path.dirname(sourceFile);
  const isDts = sourceFile.endsWith(".d.ts");

  // Case 1: Sibling file exists on disk
  //   - For .js consumer:  check for `${path}.js`
  //   - For .d.ts consumer: check for `${path}.d.ts` (the type counterpart)
  const siblingProbe = path.resolve(
    dir,
    isDts ? `${importPath}.d.ts` : `${importPath}.js`
  );
  if (fs.existsSync(siblingProbe)) {
    return `${importPath}.js`;
  }

  // Case 2: Directory import — check for index.{js|d.ts} inside the directory
  const indexProbe = path.resolve(
    dir,
    importPath,
    isDts ? "index.d.ts" : "index.js"
  );
  if (fs.existsSync(indexProbe)) {
    return `${importPath}/index.js`;
  }

  // Case 3: Fallback — emit `.js` and let Node.js runtime (or tsc under NodeNext)
  // surface a clear error. This path should not occur for well-formed tsc output.
  return `${importPath}.js`;
}

function fixESM(distDir) {
  if (!fs.existsSync(distDir)) {
    console.error(`❌ Directory not found: ${distDir}`);
    process.exit(1);
  }

  let filesFixed = 0;
  let importsFixed = 0;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts")) &&
        !entry.name.endsWith(".d.js")
      ) {
        let content = fs.readFileSync(fullPath, "utf-8");
        const originalContent = content;

        // Match `from "..."` and `from '...'` with relative specifiers.
        // Covers: static import, re-export, named re-export.
        // Does not attempt to cover side-effect-only `import "./x"` (rare and not
        // currently emitted by tsc in this repo).
        content = content.replace(
          /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
          (match, prefix, importPath, suffix) => {
            // Skip if already has a known file extension
            if (
              importPath.endsWith(".js") ||
              importPath.endsWith(".mjs") ||
              importPath.endsWith(".cjs") ||
              importPath.endsWith(".ts") ||
              importPath.endsWith(".json")
            ) {
              return match;
            }

            const resolved = resolveExtension(importPath, fullPath);
            importsFixed++;
            return `${prefix}${resolved}${suffix}`;
          }
        );

        if (content !== originalContent) {
          fs.writeFileSync(fullPath, content, "utf-8");
          filesFixed++;
          console.log(`  ✓ ${path.relative(process.cwd(), fullPath)}`);
        }
      }
    }
  }

  console.log(`\n🔧 Fixing ESM imports in ${distDir}...\n`);
  walk(distDir);

  if (filesFixed > 0) {
    console.log(`\n✅ Fixed ${filesFixed} files (${importsFixed} import paths)\n`);
  } else {
    console.log(`\n✓ No fixes needed\n`);
  }
}

const distDir = process.argv[2] || "dist";
fixESM(distDir);
