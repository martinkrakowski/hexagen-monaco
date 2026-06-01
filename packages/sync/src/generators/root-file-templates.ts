const BUILTIN_PACKAGE_JSON_TEMPLATE = `{
  "name": "{system}",
  "private": true,
  "type": "module",
  "packageManager": "{packageManager}",
  "workspaces": {workspaces},
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "clean": "turbo clean",
    "sync": "hexagen sync",
    "sync:dry": "hexagen sync --dry-run",
    "sync:force": "hexagen sync --force",
    "lint:arch": "hexagen arch validate",
    "templates:add": "hexagen add",
    "templates:validate": "hexagen validate-templates",
    "format": "prettier --write \\"**/*.{ts,tsx,md}\\""
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.5.4",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "@hexagen/sync": "^0.1.0",
    "@hexagen/arch-linter": "^0.1.0"
  }
}`;

const BUILTIN_TSCONFIG_BASE_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "composite": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "paths": {
      "@{scope}/*": [
        "./packages/*/src/index.ts"
      ]
    }
  }
}`;

const BUILTIN_TURBO_TEMPLATE = `{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": [
        "^build"
      ],
      "outputs": [
        "dist/**"
      ]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": [
        "^build"
      ]
    },
    "typecheck": {
      "outputs": [],
      "cache": true
    },
    "test": {
      "dependsOn": [
        "^build"
      ]
    }
  }
}`;

export {
  BUILTIN_PACKAGE_JSON_TEMPLATE,
  BUILTIN_TSCONFIG_BASE_TEMPLATE,
  BUILTIN_TURBO_TEMPLATE,
};
