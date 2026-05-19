const path = require('path');
const { sync: resolveSync } = require('resolve');

module.exports = (moduleName, options) => {
  // Handle any .js imports by replacing with .ts
  if (moduleName.endsWith('.js')) {
    const tsModule = moduleName.replace(/\.js$/, '.ts');
    try {
      const resolved = resolveSync(tsModule, {
        basedir: options.basedir,
        extensions: ['.ts', '.tsx', '.js', '.jsx']
      });
      return resolved;
    } catch (e) {
      // Fall back to default resolver
    }
  }

  return options.defaultResolver(moduleName, options);
};
