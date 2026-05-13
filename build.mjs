#!/usr/bin/env node
import { build } from 'esbuild'
import { readFile, rm, copyFile, chmod } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'dist')
const outFile = join(outDir, 'index.js')

const isRelease = process.argv.includes('--release') || !process.argv.includes('--debug')

await rm(outDir, { recursive: true, force: true })

const pkg = JSON.parse(await readFile(join(here, 'package.json'), 'utf-8'))
const nodeBuiltins = builtinModules.flatMap(m => [m, `node:${m}`])
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...nodeBuiltins,
]

const start = performance.now()

await build({
  entryPoints: [join(here, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: outFile,
  external,
  sourcemap: !isRelease,
  minify: isRelease,
  logLevel: isRelease ? 'error' : 'warning',
})

await copyFile(join(here, 'package.json'), join(outDir, 'package.json'))
await chmod(outFile, 0o755)

const elapsed = ((performance.now() - start) / 1000).toFixed(2)
console.log(`Built ${outFile} in ${elapsed}s`)
