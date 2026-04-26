#!/usr/bin/env node

/**
 * Fix ESM Module Resolution for ALL Compiled Files
 * 
 * Problem: TypeScript with "module": "ESNext" compiles import/export statements
 * without adding `.js` extensions. Node.js ESM requires explicit file extensions
 * for all relative imports.
 * 
 * Solution: Post-process ALL compiled JS files to add `.js` extensions to ALL
 * relative import paths that are missing them.
 * 
 * Usage: node fix-esm-barrels.js <dist-directory>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      } else if (entry.isFile() && entry.name.endsWith(".js") && !entry.name.endsWith(".d.js")) {
        let content = fs.readFileSync(fullPath, "utf-8");
        const originalContent = content;

        // Fix ALL relative imports/exports that lack .js extension
        // Matches: from "../../path" or from "../path" or from "./path"
        // But NOT: from "module-name" or from "@scope/module"
        content = content.replace(
          /(from\s+["'])(\.\.?\/.+?)(["'];)/g,
          (match, prefix, importPath, suffix) => {
            // Skip if already has file extension
            if (importPath.endsWith(".js") || importPath.endsWith(".ts") || importPath.endsWith(".mjs") || importPath.endsWith(".json")) {
              return match;
            }

            importsFixed++;
            return `${prefix}${importPath}.js${suffix}`;
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
