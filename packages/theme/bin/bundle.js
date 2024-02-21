import {build as esBuild} from 'esbuild'
import cleanBundledDependencies from '../../../bin/clean-bundled-dependencies.js'

const external = ['@shopify/cli-kit', '@oclif/core']

await esBuild({
  bundle: true,
  entryPoints: ['./src/**/*.ts'],
  outdir: './dist/cli',
  platform: 'node',
  format: 'esm',
  inject: ['../../bin/cjs-shims.js'],
  external: ['@shopify/cli-kit', '@oclif/core'],

  loader: {'.node': 'copy'},
  splitting: true,
  plugins: [],
})

await cleanBundledDependencies(external)