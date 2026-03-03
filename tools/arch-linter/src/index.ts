/// <reference types="node" />
import * as fs from 'fs';
import { Project } from 'ts-morph';
import * as yaml from 'js-yaml';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM polyfill for __dirname / __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURATION ---
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const MANIFEST_PATH = path.join(ROOT_DIR, '.architecture.yaml');
const TSCONFIG_PATH = path.join(ROOT_DIR, 'tsconfig.base.json');
const PKG_ROOT_PATH = path.join(ROOT_DIR, 'packages');
const SCOPE = '@hexagen';
// ---

function getKebabCase(s: string) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

// Load the architecture manifest
let manifest: any;
try {
  manifest = yaml.load(fs.readFileSync(MANIFEST_PATH, 'utf8'));
} catch (e) {
  console.error(
    `❌ Could not load architecture manifest from ${MANIFEST_PATH}`
  );
  process.exit(1);
}

// Initialize ts-morph project
const project = new Project({
  tsConfigFilePath: TSCONFIG_PATH,
});

function checkArchitecturalIntegrity() {
  const errors: string[] = [];
  const modules: any[] = manifest.modules || [];

  modules.forEach((moduleInfo) => {
    const moduleName = moduleInfo.name;
    const modulePath = path.join(PKG_ROOT_PATH, moduleName);

    if (!fs.existsSync(modulePath)) {
      // This is a placeholder module, skip it
      return;
    }

    const moduleSourceFiles = project
      .getSourceFiles()
      .filter((f) => f.getFilePath().startsWith(modulePath));

    moduleSourceFiles.forEach((file) => {
      const imports = file.getImportDeclarations();
      imports.forEach((imp) => {
        const moduleSpecifier = imp.getModuleSpecifierValue();

        // Rule: No imports from other modules, except 'shared'
        if (moduleSpecifier.startsWith(SCOPE) && moduleName !== 'shared') {
          const importedPkg = moduleSpecifier.split('/')[1];

          if (
            importedPkg &&
            importedPkg !== moduleName &&
            importedPkg !== 'shared'
          ) {
            errors.push(
              `
Boundary Violation in [${moduleName}]:
  File: ${path.relative(ROOT_DIR, file.getFilePath())}
  Illegal import from another module: "${moduleSpecifier}"
            `.trim()
            );
          }
        }

        // Rule: Domain can only import from other domain files or node_modules
        if (file.getFilePath().includes('/domain/')) {
          const sourceFile = imp.getModuleSpecifierSourceFile();
          if (sourceFile) {
            const importPath = sourceFile.getFilePath();
            if (
              !importPath.includes('/domain/') &&
              !importPath.includes('/node_modules/')
            ) {
              errors.push(
                `
Domain Violation in [${moduleName}]:
  Domain file: ${path.relative(ROOT_DIR, file.getFilePath())}
  Cannot import from outside the domain layer: "${moduleSpecifier}"
              `.trim()
              );
            }
          }
        }

        // Rule: Application can only import from domain, other application files, or node_modules
        if (file.getFilePath().includes('/application/')) {
          const sourceFile = imp.getModuleSpecifierSourceFile();
          if (sourceFile) {
            const importPath = sourceFile.getFilePath();
            if (
              !importPath.includes('/domain/') &&
              !importPath.includes('/application/') &&
              !importPath.includes('/node_modules/')
            ) {
              errors.push(
                `
Application Violation in [${moduleName}]:
  Application file: ${path.relative(ROOT_DIR, file.getFilePath())}
  Cannot import from outside the application/domain layers: "${moduleSpecifier}"
              `.trim()
              );
            }
          }
        }
      });
    });
  });

  // --- REPORTING ---
  if (errors.length > 0) {
    console.error(
      '\n❌ Architectural Integrity Check Failed. Found violations:\n'
    );
    errors.forEach((e) => console.error(`  - ${e}\n`));
    process.exit(1);
  } else {
    console.log('✅ Architecture is compliant with architecture.yaml.');
  }
}

console.log('Running Architectural Integrity Linter...');
checkArchitecturalIntegrity();
