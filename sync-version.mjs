#!/usr/bin/env node
/*
 * Stamps the version in package.json into every doc that quotes the SDK version.
 *
 * `npm version <v>` runs this as the `version` lifecycle script (scripts.version in package.json), so
 * the release pipeline's `npm --prefix plugin-kit version $(product.version)` moves package.json AND
 * the docs the published packages carry in one step: README.md (npmjs.com and the GitHub mirror), the
 * example csproj's partner PackageReference and SDK_PACKAGE_VERSION in plugin-rules.mjs (GitHub mirror
 * and tarball), and the NuGet package's README (nuget.org). Before this, each quoted a release by hand
 * and stayed on it while the packages moved on.
 *
 * Not shipped in the tarball (files[] does not list it). Each pattern is anchored on the package name
 * beside the version and must match at least once: a doc edit that drops the line fails `npm version`
 * instead of publishing a README that still quotes the previous release.
 *
 * Usage: node sync-version.mjs [<plugin-kit dir>]
 *   The directory defaults to this file's own; pluginSdkVersionSync.test.ts passes a copy.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const kitDir = process.argv[2] ? path.resolve(process.argv[2]) : path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(path.join(kitDir, 'package.json'), 'utf8'))

const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
const anchored = pattern => new RegExp(pattern.replace('{v}', `(${SEMVER})`), 'g')

/** Doc path, relative to plugin-kit/, -> the patterns whose one capture group is the version. */
const targets = {
  'README.md': [
    anchored(String.raw`@caxperts/toolkit-plugin-sdk@{v}`),
    anchored(String.raw`caxperts-toolkit-plugin-sdk-{v}\.tgz`),
  ],
  'example-hello/server/Example.Hello.csproj': [
    anchored(String.raw`Include="CAXperts\.Toolkit\.Plugins\.Abstractions" Version="{v}"`),
  ],
  'scripts/lib/plugin-rules.mjs': [anchored(String.raw`SDK_PACKAGE_VERSION = '{v}'`)],
  '../backend/src/Toolkit.Plugins.Abstractions/README.md': [
    anchored(String.raw`CAXperts\.Toolkit\.Plugins\.Abstractions --version {v}`),
  ],
}

for (const [doc, patterns] of Object.entries(targets)) {
  const file = path.join(kitDir, doc)
  let text = readFileSync(file, 'utf8')
  for (const pattern of patterns) {
    let matches = 0
    text = text.replace(pattern, (match, quoted) => {
      matches++
      return match.replace(quoted, version)
    })
    if (matches === 0) {
      console.error(`sync-version: ${doc} has no match for /${pattern.source}/ - restore that line, it is what gets stamped`)
      process.exit(1)
    }
  }
  writeFileSync(file, text)
  console.log(`sync-version: ${doc} -> ${version}`)
}
