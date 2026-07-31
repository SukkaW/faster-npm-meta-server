import { defineConfig } from 'rollup';
import { swc } from 'rollup-plugin-swc3';
import { oxcResolve } from 'rollup-plugin-oxc-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import { analyzer, adapter } from 'vite-bundle-analyzer';
import path from 'node:path';
import { bytes } from 'xbits';
import type { OutputChunk } from 'rollup';
import { execFileSync } from 'node:child_process';

const deployRevision = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || getGitRevision();
const deployTime = new Date().toISOString();

export default defineConfig({
  input: 'src/index.ts',
  output: {
    file: 'dist/snippet.js',
    format: 'esm',
    compact: true
  },
  treeshake: 'smallest',
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        __DEPLOY_REVISION__: JSON.stringify(deployRevision),
        __DEPLOY_TIME__: JSON.stringify(deployTime)
      }
    }),
    commonjs({
      sourceMap: false,
      esmExternals: true
    }),
    oxcResolve({
      conditionNames: ['import', 'module', 'default', 'require']
    }),
    json({
      compact: true,
      preferConst: true
    }),
    swc({
      minify: false,
      sourceMaps: process.env.ANALYZE === 'true',
      jsc: {
        minify: {
          sourceMap: process.env.ANALYZE === 'true',
          compress: {
            unsafe: true,
            ecma: 2022,
            keep_infinity: true,
            passes: 3,
            reduce_funcs: false, // disable this can improve performance
            module: true,
            toplevel: true,
            hoist_funs: true,
            unsafe_hoist_static_method_alias: false,
            unsafe_hoist_global_objects_alias: true
          },
          mangle: {
            safari10: false,
            topLevel: true
          },
          format: {
            safari10: false,
            // asciiOnly: true,
            ecma: 2024
          }
        }
      }
    }),
    {
      name: 'rollup-plugin-bundle-size',
      generateBundle(options, bundle) {
        if (options.file) {
          const asset = path.basename(options.file);
          const size = bytes((bundle[asset] as OutputChunk).code.length);
          // eslint-disable-next-line no-console -- report the generated Worker bundle size
          console.log(`Created bundle ${asset}: ${size}`);
        } else {
          // eslint-disable-next-line no-console -- report a malformed Rollup output configuration
          console.error('No output file specified!');
        }
      }
    },
    process.env.ANALYZE === 'true' && adapter(analyzer({
      analyzerMode: 'static',
      openAnalyzer: true,
      fileName: 'stats.html'
    }))
  ]
});

function getGitRevision(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return 'development';
  }
}
