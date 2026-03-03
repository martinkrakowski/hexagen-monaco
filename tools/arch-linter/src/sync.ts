import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import lodash from 'lodash';
const { kebabCase } = lodash;
import { fileURLToPath } from 'node:url';

const toPascalCase = (s: string) =>
  s
    .split(/[\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

const ensureDirExists = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const updateBarrelFile = (barrelPath: string, moduleExportPath: string) => {
  ensureDirExists(path.dirname(barrelPath));
  const exportStatement = `export * from '${moduleExportPath}';\n`;
  let content = '';
  if (fs.existsSync(barrelPath)) {
    content = fs.readFileSync(barrelPath, 'utf-8');
  }
  if (!content.includes(moduleExportPath)) {
    fs.appendFileSync(barrelPath, exportStatement);
  }
};

function syncArchitecture() {
  console.log('🔄 Synchronizing architecture from manifest...');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const rootDir = path.resolve(__dirname, '..', '..', '..');
  const manifestPath = path.join(rootDir, '.architecture.yaml');
  let manifest: any;

  try {
    manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.error(
      `❌ Could not load architecture manifest from ${manifestPath}`
    );
    process.exit(1);
  }

  const modules = manifest.modules || [];
  console.log(`Found ${modules.length} modules to sync:`);

  modules.forEach((moduleInfo: any) => {
    const moduleName = moduleInfo.name;
    const pkgPath = path.join(rootDir, 'packages', moduleName);
    const srcPath = path.join(pkgPath, 'src');

    const domainPath = path.join(srcPath, 'domain', 'model');
    const useCasesPath = path.join(srcPath, 'application', 'use-cases');
    const inboundPortsPath = path.join(srcPath, 'application', 'ports', 'in');
    const outboundPortsPath = path.join(srcPath, 'application', 'ports', 'out');

    const domainBarrel = path.join(domainPath, 'index.ts');
    const useCasesBarrel = path.join(useCasesPath, 'index.ts');
    const inboundBarrel = path.join(inboundPortsPath, 'index.ts');
    const outboundBarrel = path.join(outboundPortsPath, 'index.ts');

    console.log(`  • Syncing ${moduleName}...`);

    // 1. Entities + Domain Barrels
    (moduleInfo.entities || []).forEach((entityName: string) => {
      const pascal = toPascalCase(entityName);
      const kebab = kebabCase(entityName);
      const entityDir = path.join(domainPath, kebab);
      const entityPath = path.join(entityDir, `${kebab}.ts`);
      const entityBarrel = path.join(entityDir, 'index.ts');

      if (!fs.existsSync(entityPath)) {
        ensureDirExists(entityDir);
        const template = `export class ${pascal} {
  constructor(
    public readonly id: string,
    // TODO: Add entity properties
  ) {}
}\n`;
        fs.writeFileSync(entityPath, template);
        console.log(
          `    ✨ Generated Entity: ${path.relative(rootDir, entityPath)}`
        );
      }

      if (!fs.existsSync(entityBarrel)) {
        fs.writeFileSync(entityBarrel, `export * from './${kebab}';\n`);
      } else {
        updateBarrelFile(entityBarrel, `./${kebab}`);
      }

      updateBarrelFile(domainBarrel, `./${kebab}`);
    });

    // 2. Use Cases + Inbound Ports (lint-clean)
    (moduleInfo.use_cases || []).forEach((useCaseName: string) => {
      const pascal = toPascalCase(useCaseName);
      const kebab = kebabCase(useCaseName);

      const useCasePath = path.join(useCasesPath, `${kebab}.use-case.ts`);
      if (!fs.existsSync(useCasePath)) {
        ensureDirExists(useCasesPath);
        const template = `import type { I${pascal}Port } from '../ports/in/${kebab}.port';\n\nexport class ${pascal}UseCase implements I${pascal}Port {\n  async execute(_data: unknown): Promise<unknown> {\n    void _data; // TODO: Implement use case logic\n    return {};\n  }\n}\n`;
        fs.writeFileSync(useCasePath, template);
        console.log(
          `    ✨ Generated Use Case: ${path.relative(rootDir, useCasePath)}`
        );
      }
      updateBarrelFile(useCasesBarrel, `./${kebab}.use-case`);

      const inboundPortPath = path.join(inboundPortsPath, `${kebab}.port.ts`);
      if (!fs.existsSync(inboundPortPath)) {
        ensureDirExists(inboundPortsPath);
        const template = `// Inbound port for ${useCaseName}\nexport interface I${pascal}Port {\n  execute(data: unknown): Promise<unknown>;\n}\n`;
        fs.writeFileSync(inboundPortPath, template);
        console.log(
          `    ✨ Generated Inbound Port: ${path.relative(rootDir, inboundPortPath)}`
        );
      }
      updateBarrelFile(inboundBarrel, `./${kebab}.port`);
    });

    // 3. Entity-Specific Outbound Ports (lint-clean)
    (moduleInfo.entities || []).forEach((entityName: string) => {
      const kebab = kebabCase(entityName);
      const pascal = toPascalCase(entityName);
      const portPath = path.join(
        outboundPortsPath,
        `${kebab}-repository.port.ts`
      );
      if (!fs.existsSync(portPath)) {
        ensureDirExists(outboundPortsPath);
        const template = `import type { ${pascal} } from '../../../domain/model/${kebab}/${kebab}';

export interface I${pascal}Repository {
  save(entity: ${pascal}): Promise<${pascal}>;
  findById(_id: string): Promise<${pascal} | null>;
}\n`;
        fs.writeFileSync(portPath, template);
        console.log(
          `    ✨ Generated Outbound Port: ${path.relative(rootDir, portPath)}`
        );
      }
      updateBarrelFile(outboundBarrel, `./${kebab}-repository.port`);
    });

    // 4. Infrastructure Ports
    const infrastructure = moduleInfo.infrastructure || [];
    infrastructure.forEach((infraItem: any) => {
      let infraName = '';

      if (typeof infraItem === 'string') {
        infraName = infraItem;
      } else if (typeof infraItem === 'object') {
        const key = Object.keys(infraItem)[0];
        const value = infraItem[key];
        infraName = typeof value === 'string' ? value : key;
        if (infraName === 'ports' || Array.isArray(value)) return;
      }

      if (!infraName || infraName === 'ports') return;

      const kebab = kebabCase(infraName);
      const pascal = toPascalCase(infraName);
      const portPath = path.join(outboundPortsPath, `${kebab}.port.ts`);

      if (!fs.existsSync(portPath)) {
        ensureDirExists(outboundPortsPath);
        const template = `export interface I${pascal}Port {
  // TODO: Define methods for ${infraName} infrastructure
}\n`;
        fs.writeFileSync(portPath, template);
        console.log(
          `    ✨ Generated Outbound Port: ${path.relative(rootDir, portPath)}`
        );
      }
      updateBarrelFile(outboundBarrel, `./${kebab}.port`);
    });

    // 5. Repository Ports from infrastructure.ports array
    const infraPortsSection = infrastructure.find((i: any) => i.ports);
    const infraPorts = infraPortsSection?.ports || [];
    infraPorts.forEach((portName: string) => {
      if (
        typeof portName !== 'string' ||
        portName === 'ports' ||
        !portName.includes('-repository')
      )
        return;

      const kebab = kebabCase(portName);
      const pascal = toPascalCase(portName.replace('-repository', ''));
      const entityKebab = kebab.replace('-repository', '');
      const portPath = path.join(outboundPortsPath, `${kebab}.port.ts`);

      if (!fs.existsSync(portPath)) {
        ensureDirExists(outboundPortsPath);
        const template = `import type { ${pascal} } from '../../../domain/model/${entityKebab}/${entityKebab}';

export interface I${pascal}Repository {
  save(entity: ${pascal}): Promise<${pascal}>;
  findById(_id: string): Promise<${pascal} | null>;
}\n`;
        fs.writeFileSync(portPath, template);
        console.log(
          `    ✨ Generated Outbound Port: ${path.relative(rootDir, portPath)}`
        );
      }
      updateBarrelFile(outboundBarrel, `./${kebab}.port`);
    });
  });

  console.log('✅ Architecture sync complete.');
}

syncArchitecture();
