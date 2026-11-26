import * as esbuild from 'esbuild';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const isProduction = args.has('--production');
const isWatch = args.has('--watch');
const isTests = args.has('--tests');

if (isTests) {
  const testFiles = readdirSync('test')
    .filter(file => file.endsWith('.test.ts'))
    .map(file => join('test', file));

  await esbuild.build({
    entryPoints: testFiles,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: { '.js': '.cjs' },
    target: 'node18',
    outdir: 'dist-test',
    sourcemap: true,
    logLevel: 'info',
  });
} else {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    minify: isProduction,
    sourcemap: !isProduction,
    logLevel: 'info',
  });

  if (isWatch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}
