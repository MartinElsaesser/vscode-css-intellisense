const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  esbuild
    .context(options)
    .then((ctx) => ctx.watch())
    .catch(() => process.exit(1));
} else {
  esbuild.build(options).catch(() => process.exit(1));
}
