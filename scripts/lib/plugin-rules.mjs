/*
 * Constants shared by the plugin author-side scripts (`pack-plugin.mjs`, `new-plugin.mjs`).
 *
 * Only the literals live here, not the validation functions. The functions in pack-plugin.mjs carry
 * long comments explaining WHY each rule exists, and those comments are the documentation an author
 * reads when a check fires — moving them into a shared module would separate the rule from its
 * reason. What actually drifts when a second script is written is the constants, which is what a
 * copy-paste duplicates.
 *
 * Each value mirrors something the host enforces. `pluginRuntimeSurface.test.ts` pins
 * SUPPORTED_API_VERSION and ICON_NAMES against their host-side definitions, so a bump on one side
 * fails a test rather than being discovered by a partner.
 *
 * Deliberately dependency-free and importable with a plain relative path: a partner running
 * pack-plugin.mjs has only an npm-installed SDK, not this repository, so nothing here may reach for
 * `@caxperts/toolkit-plugin-sdk` or any package.
 */

/** Mirrors PluginManifestReader.IdPattern. Also the CSS scope class and the install folder name. */
export const ID_PATTERN = /^[a-z0-9]([a-z0-9.\-]{0,62})[a-z0-9]$/

/**
 * Mirrors PluginManifestReader.ReservedIds. Each one would collide with a host route segment under
 * `api/plugins/{id}` or `/plugins/{id}`.
 */
export const RESERVED_IDS = new Set(['admin', 'assets', 'health', 'swagger', 'settings'])

/** Mirrors PluginManifestReader.SchemaPattern — the plg_ boundary, at the manifest level. */
export const SCHEMA_PATTERN = /^plg_[a-z0-9_]{1,50}$/

/**
 * Mirrors PluginApiVersion.Current and the SDK's PLUGIN_API_VERSION.
 *
 * Not imported from either: the C# is not readable from Node, and `../plugin-kit/src/types.ts` does
 * not exist for a partner who installed the SDK from a tarball. A grep test in the host holds the
 * three in agreement instead.
 */
export const SUPPORTED_API_VERSION = 1

/**
 * The released version of the one backend NuGet package, CAXperts.Toolkit.Plugins.Abstractions on
 * nuget.org, which carries Toolkit.Data and Toolkit.Domain inside it. The release pipeline
 * (caxperts.azure-pipelines-release.yaml) publishes it and @caxperts/toolkit-plugin-sdk on npmjs.com
 * under the host's release version (the release_net/<version> tag), so this is a host version, not
 * the 0.x PluginSdkPackageVersion the in-repo build stamps on a dev pack.
 *
 * new-plugin.mjs stamps the scaffolded backend with it, so a fresh full-stack plugin references the
 * same host SDK version this repository publishes. A partner bumps it (and the matching host) as one
 * decision; keeping it here rather than hardcoded in the template keeps the scaffold from drifting from
 * the package it is meant to build against.
 *
 * Not read from package.json: in this repository that is the 0.x dev version, which is never on
 * nuget.org, while this literal is a release that is. The two meet at release time instead -
 * `npm version <release>` runs sync-version.mjs, which rewrites this line (and every doc that quotes
 * the version) to the version being published, so the tarball and the GitHub mirror carry it.
 */
export const SDK_PACKAGE_VERSION = '2026.4.1'

/**
 * Mirrors the PluginIconName union in plugin-kit/src/types.ts and the ICONS map in
 * frontend/src/plugin-runtime/icons.tsx.
 *
 * Used only for a warning: an unrecognised name renders the generic extension icon rather than
 * failing, so a package naming one is valid — just not showing the icon its author expected.
 */
export const ICON_NAMES = new Set([
  'extension',
  'clipboard',
  'chart',
  'checklist',
  'document',
  'folder',
  'gear',
  'grid',
  'info',
  'layers',
  'link',
  'list',
  'lock',
  'map',
  'people',
  'search',
  'star',
  'tag',
  'timer',
  'warning',
])
