#!/usr/bin/env node
/*
 * Post-processing for `npm run build`, run after `tsc -p tsconfig.build.json`. Not shipped in the
 * tarball (files[] lists dist/, not this file) — it only ever runs in this repository or in `npm pack`'s
 * prepack.
 *
 * Two jobs:
 *
 * 1. Rewrite `.ts` import/export extensions to `.js` in the emitted .d.ts files. tsconfig's
 *    `rewriteRelativeImportExtensions` does this for the emitted .js but NOT for the .d.ts — so
 *    dist/index.d.ts still says `from './types.ts'`, which resolves to a file the tarball does not
 *    contain (it ships types.d.ts, not types.ts). A consumer's tsc would then report the SDK's own
 *    declarations as broken. This closes that gap so the .d.ts references its real siblings.
 *
 * 2. Emit the ui/ and data/ shims. They are excluded from the tsc build (they re-export
 *    devextreme-react / devextreme, optional peers not installed here, so tsc cannot resolve them).
 *    They carry NO types of their own — each is two `export … from 'devextreme…'` lines — so the
 *    compiled .js and the .d.ts are byte-identical to the source, and copying is exactly correct. The
 *    re-export resolves against the CONSUMER's devextreme install, precisely as the source .ts did.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const kitDir = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(kitDir, 'src')
const distDir = path.join(kitDir, 'dist')

// --- 1. Rewrite .ts extensions in emitted declarations -----------------------
// Only relative specifiers (./ or ../) are touched; a bare 'devextreme/…' is never a .ts path.
const rewriteTsExtensions = source =>
  source.replace(/(from\s*['"])(\.\.?\/[^'"]+?)\.ts(['"])/g, '$1$2.js$3')

const walkDts = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absPath = path.join(dir, entry.name)
    if (entry.isDirectory()) walkDts(absPath)
    else if (entry.name.endsWith('.d.ts')) {
      const rewritten = rewriteTsExtensions(readFileSync(absPath, 'utf8'))
      writeFileSync(absPath, rewritten)
    }
  }
}

walkDts(distDir)

// --- 2. Emit the ui/ and data/ shims as .js + .d.ts --------------------------
for (const folder of ['ui', 'data']) {
  const from = path.join(srcDir, folder)
  const to = path.join(distDir, folder)
  mkdirSync(to, { recursive: true })

  for (const file of readdirSync(from).filter(name => name.endsWith('.ts'))) {
    const base = file.replace(/\.ts$/, '')
    const source = readFileSync(path.join(from, file), 'utf8')
    // Same bytes as .js and as .d.ts: the file is only `export … from 'devextreme…'`, which is valid
    // in both and carries nothing to strip.
    writeFileSync(path.join(to, `${base}.js`), source)
    writeFileSync(path.join(to, `${base}.d.ts`), source)
  }
}

// Sanity: the vite entry is the one Node actually executes, so a missing dist/vite/index.js is the
// exact regression this build exists to prevent. Fail loudly rather than ship a broken tarball.
const viteEntry = path.join(distDir, 'vite', 'index.js')
try {
  readFileSync(viteEntry)
} catch {
  console.error(`finish-build: ${path.relative(kitDir, viteEntry)} missing — did tsc run first?`)
  process.exit(1)
}
