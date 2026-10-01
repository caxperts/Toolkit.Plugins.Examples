#!/usr/bin/env node
/*
 * Validates a built plugin and zips it into an installable package.
 *
 * Partners run this exact script, so every check here is one the host would otherwise fail at
 * install time — with the difference that here the message arrives while the author can still fix
 * it, instead of as a rejected upload in a customer's Settings page.
 *
 * Usage:
 *   node plugin-kit/scripts/pack-plugin.mjs --plugin plugin-kit/example-hello [--out <dir>] [--stage]
 *   node plugin-kit/scripts/pack-plugin.mjs --plugin plugin-kit/example-hello --check
 *
 * Options:
 *   --plugin <dir>  Plugin source directory containing plugin.json. Required.
 *   --out <dir>     Where to write the .zip. Defaults to the plugin directory.
 *   --stage         Also expand the package into .plugins-dev/<id>/ so a local `dotnet run`
 *                   picks it up with no upload step.
 *   --check         Validate only: manifest, migrations, menu, translations. Needs NO build output,
 *                   so a manifest typo costs a second instead of a `vite build` plus a
 *                   `dotnet publish`. Alias: --validate-only.
 *
 * Exits non-zero on any validation failure, so it is safe to call from CI.
 *
 * Errors vs warnings: something is an ERROR only if the host's PluginManifestReader would reject the
 * package at install. Anything the host accepts but that will look broken to a user — an untranslated
 * menu label, an unknown icon name — is a WARNING, because failing a package the host would install
 * is a new restriction on plugins rather than help.
 */
import { Buffer } from 'node:buffer'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import {
  ICON_NAMES,
  ID_PATTERN,
  RESERVED_IDS,
  SCHEMA_PATTERN,
  SUPPORTED_API_VERSION,
} from './lib/plugin-rules.mjs'

function fail(message) {
  console.error(`pack-plugin: ${message}`)
  process.exit(1)
}

/**
 * Collected rather than printed as they are found, so the summary can state a count and the author
 * sees them together after the errors that would have stopped the run.
 */
const warnings = []
function warn(message) {
  warnings.push(message)
}

/**
 * Printed once, after every check has run. A warning that scrolled past mid-run — between a build
 * step and a zip step — is a warning nobody reads.
 */
function reportWarnings() {
  for (const message of warnings) console.warn(`pack-plugin: warning: ${message}`)
}

function countTranslationKeys(manifest) {
  return Object.values(manifest.translations ?? {}).reduce(
    (total, entries) => total + Object.keys(entries).length,
    0,
  )
}

function parseArgs(argv) {
  const args = { stage: false, check: false }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--plugin':
        args.plugin = argv[++i]
        break
      case '--out':
        args.out = argv[++i]
        break
      case '--stage':
        args.stage = true
        break
      case '--check':
      case '--validate-only':
        args.check = true
        break
      default:
        fail(`unknown argument "${argv[i]}"`)
    }
  }
  if (!args.plugin) fail('--plugin <dir> is required')
  if (args.check && args.stage) fail('--check validates only; it cannot be combined with --stage')
  return args
}

/**
 * Rules every declared package-relative path must satisfy. `PluginPaths.TryResolveInside` rejects the
 * same shapes host-side; checking them here means a package that would be refused at install never
 * gets built.
 */
function validatePackagePath(value, label, { folder, extensions }) {
  if (typeof value !== 'string' || value.length === 0) fail(`plugin.json ${label} must be a path`)
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value))
    fail(`plugin.json ${label} "${value}" must be relative`)
  if (value.replaceAll('\\', '/').split('/').includes('..'))
    fail(`plugin.json ${label} "${value}" must not contain ".."`)

  // `assemble` copies the frontend build into frontend/ and the published backend into backend/, so a
  // path outside its folder can never resolve in the installed package however valid it looks here.
  if (folder && !value.replaceAll('\\', '/').startsWith(`${folder}/`))
    fail(`plugin.json ${label} "${value}" must be inside ${folder}/`)

  if (extensions && !extensions.some(ext => value.toLowerCase().endsWith(ext)))
    fail(`plugin.json ${label} "${value}" must end in ${extensions.join(' or ')}`)
}

/**
 * Holds the hand-written `migrations/*.sql` to the same plg_ boundary the host enforces on EF
 * migrations.
 *
 * Those scripts are the AutoMigrate=false path: a DBA applies them and the host never sees them, so
 * `PluginSchemaGuard` cannot cover them. Checking here is the only enforcement they get, and the author
 * is the right person to see the message.
 *
 * Only object-CREATING and object-ALTERING statements are matched, not every qualified name. A blanket
 * `schema.` scan trips over table aliases — `sys.tables t JOIN sys.schemas s ON s.schema_id` has `t.`
 * and `s.` in it — which would make the check noise the author learns to ignore.
 */
function validateMigrationSql(pluginDir, schema) {
  const dir = path.join(pluginDir, 'migrations')
  if (!existsSync(dir)) return 0

  const statements = [
    // CREATE SCHEMA [x] — the schema a script brings into existence.
    { pattern: /\bCREATE\s+SCHEMA\s+\[?([A-Za-z_][\w]*)\]?/gi, what: 'CREATE SCHEMA' },
    // CREATE/ALTER/DROP TABLE|INDEX|VIEW … [x].[y] — anything that needs a qualified target.
    {
      pattern:
        /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|VIEW|PROCEDURE|FUNCTION|TRIGGER)\s+\[?([A-Za-z_][\w]*)\]?\s*\./gi,
      what: 'CREATE/ALTER/DROP',
    },
    // CREATE INDEX … ON [x].[y]
    { pattern: /\bON\s+\[?([A-Za-z_][\w]*)\]?\s*\.\s*\[?[A-Za-z_][\w]*\]?\s*\(/gi, what: 'CREATE INDEX ... ON' },
  ]

  const files = readdirSync(dir).filter(name => name.toLowerCase().endsWith('.sql')).sort()

  for (const file of files) {
    // Comments stripped first: the header of a generated script explains what it does and routinely
    // names dbo, and a rule that fires on prose is a rule authors work around.
    const sql = readFileSync(path.join(dir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*--.*$/gm, '')

    for (const { pattern, what } of statements) {
      for (const match of sql.matchAll(pattern)) {
        const target = match[1]
        if (target.toLowerCase() === schema.toLowerCase()) continue

        fail(
          `migrations/${file}: ${what} targets schema "${target}", but this plugin owns "${schema}". ` +
            'A plugin\'s SQL may only create or alter objects inside its own plg_ schema — the host ' +
            'enforces the same rule on EF migrations and would refuse to load the plugin.',
        )
      }
    }
  }

  return files.length
}

/** Everything the host's PluginManifestReader checks, in the same order and with the same rules. */
function validateManifest(manifest, pluginDir) {
  if (typeof manifest.id !== 'string' || !ID_PATTERN.test(manifest.id))
    fail(`plugin.json id "${manifest.id}" must match ${ID_PATTERN}`)

  if (RESERVED_IDS.has(manifest.id)) fail(`plugin.json id "${manifest.id}" is reserved`)
  if (!manifest.name) fail('plugin.json has no "name"')
  if (!manifest.version) fail('plugin.json has no "version"')
  if (manifest.apiVersion !== SUPPORTED_API_VERSION)
    fail(`plugin.json apiVersion must be ${SUPPORTED_API_VERSION}, got ${manifest.apiVersion}`)

  if (manifest.database?.schema && !SCHEMA_PATTERN.test(manifest.database.schema))
    fail(`plugin.json database.schema "${manifest.database.schema}" must match ${SCHEMA_PATTERN}`)

  const hasBackend = Boolean(manifest.entryAssembly)
  const hasFrontend = Boolean(manifest.frontend?.entry)
  if (!hasBackend && !hasFrontend)
    fail('plugin.json declares neither an entryAssembly nor a frontend entry')

  // `.dll` and the traversal check both mirror PluginManifestReader: a bare startsWith('backend/')
  // accepts "backend/../../host/Toolkit.Api.dll", which the host resolves and refuses.
  if (hasBackend)
    validatePackagePath(manifest.entryAssembly, 'entryAssembly', {
      folder: 'backend',
      extensions: ['.dll'],
    })

  if (hasFrontend) {
    // The extension matters twice over: the host's manifest reader only checks containment, but the
    // SPA's isValidAssetPath requires .js/.mjs before it will import() the module — so a
    // "frontend/index.ts" installs cleanly and then fails in the browser with a message about an
    // invalid asset path, naming nothing an author could act on.
    validatePackagePath(manifest.frontend.entry, 'frontend.entry', {
      folder: 'frontend',
      extensions: ['.js', '.mjs'],
    })

    for (const css of manifest.frontend.css ?? [])
      validatePackagePath(css, 'frontend.css entry', { folder: 'frontend', extensions: ['.css'] })
  }

  // Every translation key must be {id}.-prefixed, or the host rejects the package outright — this is
  // what stops a plugin from overwriting a host string such as "Save".
  const languages = Object.entries(manifest.translations ?? {})
  for (const [language, entries] of languages) {
    if (!language) fail('plugin.json has a translation with an empty language code')
    for (const key of Object.keys(entries)) {
      if (!key.startsWith(`${manifest.id}.`))
        fail(`translation key "${key}" (${language}) must start with "${manifest.id}."`)
    }
  }

  if (languages.length > 0 && !languages.some(([language]) => language === 'en-US'))
    warn('translations declare no "en-US"; that is the host\'s default language')

  // The rendered menu comes from the module, but these entries are what seeds PageAccess, so a typo
  // here means a nav row an admin cannot toggle.
  const translated = new Set(languages.flatMap(([, entries]) => Object.keys(entries)))
  for (const item of manifest.frontend?.menu ?? []) {
    if (typeof item.path !== 'string') fail('a frontend.menu entry has no "path"')
    if (item.path.startsWith('/') || item.path.includes('..'))
      fail(`frontend.menu path "${item.path}" must be relative and free of ".."`)
    if (!item.label) fail(`frontend.menu entry "${item.path}" has no "label"`)

    // A label written as a translation key that nothing translates renders as the raw key in the
    // sidebar — "acme.Inspections" rather than "Inspections". The host has no way to know that was
    // not intended, so this can only ever be a warning.
    if (item.label.startsWith(`${manifest.id}.`) && !translated.has(item.label))
      warn(`frontend.menu label "${item.label}" has no translation; the sidebar will show the raw key`)

    if (item.icon && !ICON_NAMES.has(item.icon) && !item.iconPath)
      warn(`frontend.menu icon "${item.icon}" is not a host icon name; the generic icon will render`)
  }

  return { hasBackend, hasFrontend, pluginDir }
}

/**
 * Warns when an adjacent `vite.config.ts` passes `toolkitPlugin({ id })` that disagrees with the
 * manifest.
 *
 * That mismatch is invisible everywhere else: the build succeeds, the package installs, and the
 * stylesheet ships scoped to `.tk-plugin-<the-wrong-id>` while the host renders
 * `.tk-plugin-<the-right-id>`. The plugin then loads with no styling at all and nothing reports why.
 *
 * A warning rather than an error because it is a regex over source: the preset also accepts a computed
 * id, and failing a package that builds today would be a new restriction. Omitting the option entirely
 * is the fix — the preset reads the manifest itself.
 */
function checkViteConfigId(pluginDir, manifest) {
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mts']) {
    const configPath = path.join(pluginDir, name)
    if (!existsSync(configPath)) continue

    const source = readFileSync(configPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')

    const declared = source.match(/toolkitPlugin\(\s*\{[^}]*\bid\s*:\s*['"]([^'"]+)['"]/)?.[1]
    if (declared !== undefined && declared !== manifest.id)
      warn(
        `${name} passes toolkitPlugin({ id: "${declared}" }) but plugin.json says "${manifest.id}". ` +
          'The CSS scope would not match the class the host renders, so the plugin would load ' +
          'unstyled. Drop the option and the preset reads plugin.json itself.',
      )

    return
  }
}

/**
 * Assembles the layout the host expects — plugin.json at the root, plus backend/, frontend/ and
 * migrations/ — from the plugin's build output.
 */
function assemble(pluginDir, manifest, staging) {
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })

  writeFileSync(path.join(staging, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n')

  if (manifest.frontend?.entry) {
    const dist = path.join(pluginDir, 'dist')
    if (!existsSync(dist)) fail('dist/ not found — run the plugin\'s build first')

    const entryName = path.basename(manifest.frontend.entry)
    if (!existsSync(path.join(dist, entryName)))
      fail(`dist/${entryName} not found, but plugin.json declares frontend.entry "${manifest.frontend.entry}"`)

    for (const css of manifest.frontend.css ?? []) {
      const cssName = path.basename(css)
      if (!existsSync(path.join(dist, cssName)))
        fail(`dist/${cssName} not found, but plugin.json declares it in frontend.css`)
    }

    cpSync(dist, path.join(staging, 'frontend'), { recursive: true })
  }

  for (const folder of ['backend', 'migrations']) {
    const source = path.join(pluginDir, folder)
    if (existsSync(source)) cpSync(source, path.join(staging, folder), { recursive: true })
  }

  if (manifest.entryAssembly) {
    const assembly = path.join(staging, manifest.entryAssembly)
    if (!existsSync(assembly))
      fail(`${manifest.entryAssembly} not found — publish the backend project into backend/ first`)
  }
}

/**
 * Warns when the package carries assemblies the host already ships.
 *
 * A ProjectReference or PackageReference to the SDK needs
 * `<ExcludeAssets>runtime;native</ExcludeAssets>`, and getting it wrong is silent: the extra DLLs are
 * inert, because PluginLoadContext delegates every host-owned assembly name back to the host's own load
 * context. What is not silent is the size. Excluding only `runtime` and not `native` left
 * Microsoft.Data.SqlClient's per-platform SNI binaries — under `runtimes`, in a `native` folder — in
 * place, and made a package 717 kB instead of 34 kB: 700 kB of Windows-only binaries bound for a Linux
 * container, duplicating a library the host already has.
 *
 * A warning rather than an error, because a stray copy genuinely is inert and failing the package would
 * be a new restriction. It fires at `npm run pack` on the author's machine and in CI, which is where the
 * 700 kB went unnoticed.
 */
function checkForHostAssets(staging) {
  const offenders = []

  const walk = dir => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, dirent.name)
      const name = path.relative(staging, absPath).replaceAll(path.sep, '/')

      if (dirent.isDirectory()) {
        // Reported as one entry rather than every binary inside it: the fix is the same for all of them,
        // and a per-file list of a dozen SNI variants buries the message.
        if (dirent.name === 'native') offenders.push(`${name}/**`)
        else walk(absPath)
        continue
      }

      // Prefix-matched against the same list PluginLoadContext treats as host-owned, narrowed to the
      // ones a plugin's own references actually drag in.
      if (/^(Toolkit\.|Microsoft\.EntityFrameworkCore|Microsoft\.Data\.SqlClient)/.test(dirent.name))
        offenders.push(name)
    }
  }

  walk(staging)

  if (offenders.length > 0)
    warn(
      `the package contains ${offenders.length} file(s) the host already ships: ` +
        `${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? ', …' : ''}. ` +
        'Add <ExcludeAssets>runtime;native</ExcludeAssets> to the SDK references in your .csproj — ' +
        'both words, since they are separate NuGet asset classes. The copies are inert (the host owns ' +
        'those assembly names) but they can be hundreds of kilobytes of the wrong platform.',
    )
}

/**
 * Cross-checks the manifest id against the id the built bundle actually declares. The host rejects a
 * mismatch at load time; catching it here is the difference between a build error and a support
 * ticket.
 */
function verifyDeclaredId(pluginDir, manifest) {
  if (!manifest.frontend?.entry) return

  const bundlePath = path.join(pluginDir, 'dist', path.basename(manifest.frontend.entry))

  // `assemble` has the friendly "run the plugin's build first" message, but it runs after this
  // function — so without this check, the commonest mistake of all (packing before building) surfaced
  // as a raw ENOENT stack trace out of readFileSync.
  if (!existsSync(bundlePath))
    fail(
      `${path.relative(pluginDir, bundlePath).replaceAll(path.sep, '/')} not found — run the ` +
        "plugin's build first",
    )

  const bundle = readFileSync(bundlePath, 'utf8')

  // The bundle is minified, so match the id as a string literal rather than parsing it.
  if (!bundle.includes(`"${manifest.id}"`) && !bundle.includes(`'${manifest.id}'`))
    fail(
      `the built bundle does not mention the id "${manifest.id}" — definePlugin({ id }) and ` +
        'plugin.json must agree, or the host will reject the plugin',
    )
}

// ---------------------------------------------------------------------------
// ZIP writing
// ---------------------------------------------------------------------------
//
// Written here rather than shelled out to `tar`, which was the original approach and was silently
// wrong on the CI agents. "tar" is two different programs:
//
//   * bsdtar (libarchive) — what Windows 10+ ships in System32. Handles `-a -c -f out.zip` and
//     really does write a ZIP.
//   * GNU tar — what every Linux agent ships. It CANNOT write ZIP archives at all. Its `-a`
//     (--auto-compress) does not recognise the .zip suffix, so it writes an uncompressed POSIX tar
//     archive under the .zip name and exits 0. No warning, no error.
//
// So the Linux canary published a "hello-1.0.0.zip" that was a tar file, and it took reading the
// bytes to notice. GNU tar also treats a Windows absolute path as a remote host spec ("C:\..." =>
// host "C:"), so the same call failed outright from Git Bash with "Cannot connect to C:".
//
// Doing it in-process removes the flavour lottery, the path quoting, and the shell dependency. It
// also has to stay dependency-free: the repo root's `archiver` is not an option, because no
// pipeline step runs `npm ci` at the root, so root node_modules does not exist on the agent.

/** CRC-32 (IEEE), as ZIP requires. */
let crcTable
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }

  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** MS-DOS date/time, the only timestamp a base ZIP record carries. */
function dosDateTime(when) {
  // DOS epoch is 1980; anything earlier (or a zeroed mtime) clamps to 1980-01-01.
  if (when.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 }

  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  }
}

/**
 * Collects the files to archive, depth-first and name-sorted so the same input produces the same
 * archive. Only files are emitted: directory entries are optional in ZIP and the host skips them
 * (it creates parents from each file's path), so they would be bytes carrying no information.
 */
function collectFiles(staging) {
  const files = []

  const walk = (dir, prefix) => {
    const dirents = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )

    for (const dirent of dirents) {
      const absPath = path.join(dir, dirent.name)
      const name = prefix ? `${prefix}/${dirent.name}` : dirent.name

      // A symlink would either dangle or smuggle in content from outside the staging directory, and
      // the host rejects non-regular entries anyway. Fail rather than resolve it.
      if (dirent.isSymbolicLink()) fail(`${name} is a symbolic link; packages must contain real files`)
      else if (dirent.isDirectory()) walk(absPath, name)
      else if (dirent.isFile()) files.push({ name, absPath })
      else fail(`${name} is not a regular file`)
    }
  }

  walk(staging, '')
  return files
}

/**
 * Rejects a name the host's preflight would reject. `assemble` controls the layout, so this should
 * be unreachable — it exists so that if it ever is reachable, it fails here rather than in a
 * customer's Settings page.
 */
function validateEntryName(name) {
  if (name.length === 0) fail('an entry has an empty name')
  if (name.startsWith('/')) fail(`entry "${name}" is rooted; package paths must be relative`)
  if (name.includes(':')) fail(`entry "${name}" looks like an absolute path`)
  if (name.split('/').includes('..')) fail(`entry "${name}" traverses outside the package`)
  if (/[\u0000-\u001f\u007f]/.test(name)) fail(`entry "${name}" contains control characters`)
}

const LOCAL_HEADER_SIG = 0x04034b50
const CENTRAL_HEADER_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const UINT32_MAX = 0xffffffff

/**
 * Builds a ZIP with no ZIP64 records, which keeps the writer small and is why the limits below are
 * checked explicitly: exceeding them needs ZIP64, and writing a truncated field instead would
 * produce exactly the kind of quietly-corrupt archive this function exists to avoid.
 */
function buildZip(files) {
  if (files.length > 0xffff) fail(`${files.length} entries exceeds the 65535 a non-ZIP64 archive holds`)

  const parts = []
  const central = []
  const written = []
  let offset = 0

  for (const file of files) {
    validateEntryName(file.name)

    const content = readFileSync(file.absPath)
    const nameBytes = Buffer.from(file.name, 'utf8')
    if (nameBytes.length > 0xffff) fail(`entry "${file.name}" has too long a name`)
    if (content.length > UINT32_MAX) fail(`entry "${file.name}" is larger than 4 GiB, which needs ZIP64`)

    // Deflate unless it does not pay: an empty file compresses to 2 bytes of framing, and already
    // compressed content (png, woff2) usually grows. Storing keeps the archive honest and sidesteps
    // the host's compression-ratio ceiling.
    const deflated = content.length === 0 ? null : deflateRawSync(content)
    const stored = deflated === null || deflated.length >= content.length
    const payload = stored ? content : deflated
    const method = stored ? 0 : 8

    const crc = crc32(content)
    const { time, date } = dosDateTime(statSync(file.absPath).mtime)
    // Bit 11 declares the name is UTF-8. Set only when it matters, so ASCII names stay byte-identical
    // to what every other packer produces.
    const flags = nameBytes.length === file.name.length ? 0 : 0x0800

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0)
    local.writeUInt16LE(20, 4) // version needed: 2.0
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // no extra field

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(CENTRAL_HEADER_SIG, 0)
    entry.writeUInt16LE(20, 4) // version made by: 2.0, MS-DOS. Keeps ExternalAttributes meaningful
    entry.writeUInt16LE(20, 6) //   as DOS attributes, which is why 0 below reads as "regular file".
    entry.writeUInt16LE(flags, 8)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt16LE(time, 12)
    entry.writeUInt16LE(date, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(payload.length, 20)
    entry.writeUInt32LE(content.length, 24)
    entry.writeUInt16LE(nameBytes.length, 28)
    entry.writeUInt16LE(0, 30) // extra
    entry.writeUInt16LE(0, 32) // comment
    entry.writeUInt16LE(0, 34) // disk number start
    entry.writeUInt16LE(0, 36) // internal attributes
    entry.writeUInt32LE(0, 38) // external attributes: the host reads the high bits as a Unix file
    entry.writeUInt32LE(offset, 42) //   mode and 0 means "not Unix", i.e. a plain file.

    parts.push(local, nameBytes, payload)
    central.push(entry, nameBytes)
    written.push({ name: file.name, crc, size: content.length, method })

    offset += local.length + nameBytes.length + payload.length
    if (offset > UINT32_MAX) fail('the package exceeds 4 GiB, which needs ZIP64')
  }

  const centralOffset = offset
  const centralSize = central.reduce((total, part) => total + part.length, 0)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4) // this disk
  eocd.writeUInt16LE(0, 6) // disk holding the central directory
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  eocd.writeUInt16LE(0, 20) // no archive comment

  return { bytes: Buffer.concat([...parts, ...central, eocd]), written }
}

/**
 * Reads the finished file back and checks it against what was meant to be written: the central
 * directory, then every local header, then the payloads — inflated and CRC-checked.
 *
 * This is the check whose absence let a tar archive ship under a .zip name through green builds. It
 * runs wherever the script runs, so the Linux agent now proves the format on every canary build
 * instead of taking the packer's word for it.
 */
function verifyZip(outputFile, expected) {
  const bytes = readFileSync(outputFile)

  if (bytes.length < 22 || bytes.readUInt32LE(0) !== LOCAL_HEADER_SIG)
    fail(`${outputFile} does not start with a ZIP local file header — it is not a ZIP archive`)

  // No archive comment is written, so the end-of-central-directory record is the last 22 bytes.
  const eocd = bytes.length - 22
  if (bytes.readUInt32LE(eocd) !== EOCD_SIG) fail(`${outputFile} has no end-of-central-directory record`)

  const count = bytes.readUInt16LE(eocd + 10)
  const centralSize = bytes.readUInt32LE(eocd + 12)
  let cursor = bytes.readUInt32LE(eocd + 16)

  if (count !== expected.length) fail(`${outputFile} lists ${count} entries, expected ${expected.length}`)
  if (cursor + centralSize !== eocd) fail(`${outputFile} has a central directory of the wrong size`)

  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(cursor) !== CENTRAL_HEADER_SIG)
      fail(`${outputFile} central directory entry ${i} has a bad signature`)

    const method = bytes.readUInt16LE(cursor + 10)
    const crc = bytes.readUInt32LE(cursor + 16)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const size = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength)

    const want = expected[i]
    if (name !== want.name) fail(`${outputFile} entry ${i} is "${name}", expected "${want.name}"`)
    if (crc !== want.crc || size !== want.size || method !== want.method)
      fail(`${outputFile} entry "${name}" has a central directory record that disagrees with its content`)

    if (bytes.readUInt32LE(localOffset) !== LOCAL_HEADER_SIG)
      fail(`${outputFile} entry "${name}" points at a bad local header`)

    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localName = bytes.toString('utf8', localOffset + 30, localOffset + 30 + localNameLength)
    if (localName !== name)
      fail(`${outputFile} entry "${name}" has a local header naming "${localName}"`)

    // Every field the local header duplicates is compared, not just the name: readers are entitled
    // to trust either copy — .NET validates the CRC it finds in the local header — so a disagreement
    // between the two is an archive that works in one reader and fails in another.
    if (
      bytes.readUInt16LE(localOffset + 8) !== method ||
      bytes.readUInt32LE(localOffset + 14) !== crc ||
      bytes.readUInt32LE(localOffset + 18) !== compressedSize ||
      bytes.readUInt32LE(localOffset + 22) !== size
    )
      fail(`${outputFile} entry "${name}" has a local header that disagrees with the central directory`)

    const dataStart = localOffset + 30 + localNameLength + bytes.readUInt16LE(localOffset + 28)
    const payload = bytes.subarray(dataStart, dataStart + compressedSize)

    let content
    try {
      content = method === 8 ? inflateRawSync(payload) : payload
    } catch (error) {
      // Reported rather than thrown: a raw zlib stack trace out of a packaging tool tells the author
      // nothing about which entry is wrong or what to do next.
      fail(`${outputFile} entry "${name}" is not valid deflate data (${error.message})`)
    }

    if (content.length !== size || crc32(content) !== crc)
      fail(`${outputFile} entry "${name}" does not decompress back to its declared bytes`)

    cursor += 46 + nameLength + extraLength + commentLength
  }

  if (!expected.some(entry => entry.name === 'plugin.json'))
    fail(`${outputFile} has no plugin.json at its root`)
}

function zip(staging, outputFile) {
  rmSync(outputFile, { force: true })

  // Names are relative to the staging root and use forward slashes, so no entry carries a './'
  // prefix. The host tolerates that prefix, but a package should be clean at the source.
  const { bytes, written } = buildZip(collectFiles(staging))

  writeFileSync(outputFile, bytes)
  verifyZip(outputFile, written)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const pluginDir = path.resolve(args.plugin)

  const manifestPath = path.join(pluginDir, 'plugin.json')
  if (!existsSync(manifestPath)) fail(`no plugin.json in ${pluginDir}`)

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    fail(`plugin.json is not valid JSON: ${error.message}`)
  }

  validateManifest(manifest, pluginDir)

  // Before verifyDeclaredId, which needs the built bundle. In the other order a missing dist/ stopped
  // the run first, so a plugin with a cross-schema migration was told to go and build — and the real
  // problem only surfaced on the next attempt. Both --check and the full path now report in the same
  // order, which is the point of --check being a prefix of the full run rather than a separate path.
  const migrationCount = manifest.database?.schema
    ? validateMigrationSql(pluginDir, manifest.database.schema)
    : 0

  checkViteConfigId(pluginDir, manifest)

  if (args.check) {
    reportWarnings()
    console.log(
      `pack-plugin: ${manifest.id} ${manifest.version} — manifest OK, ` +
        `${migrationCount} migration${migrationCount === 1 ? '' : 's'} OK, ` +
        `${countTranslationKeys(manifest)} translation keys, ` +
        `${manifest.frontend?.menu?.length ?? 0} menu entries, ${warnings.length} warnings`,
    )
    return
  }

  verifyDeclaredId(pluginDir, manifest)

  const staging = path.join(pluginDir, '.pack-staging')
  assemble(pluginDir, manifest, staging)

  // After assemble, so it sees exactly the tree that becomes the package.
  checkForHostAssets(staging)

  const outDir = args.out ? path.resolve(args.out) : pluginDir
  mkdirSync(outDir, { recursive: true })
  const outputFile = path.join(outDir, `${manifest.id}-${manifest.version}.zip`)

  try {
    zip(staging, outputFile)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }

  reportWarnings()

  const { size } = statSync(outputFile)
  console.log(`pack-plugin: ${path.relative(process.cwd(), outputFile)} (${size} bytes)`)

  if (args.stage) {
    // Expanded rather than zipped: the dev loop is "drop a folder on the volume", which needs no
    // upload and no admin session.
    const stageRoot = path.join(pluginDir, '..', '..', '.plugins-dev', manifest.id)
    rmSync(stageRoot, { recursive: true, force: true })
    mkdirSync(path.dirname(stageRoot), { recursive: true })
    assemble(pluginDir, manifest, stageRoot)
    console.log(`pack-plugin: staged into ${path.relative(process.cwd(), stageRoot)}`)
  }
}

await main()
