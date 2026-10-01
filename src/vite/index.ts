import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin, ResolvedConfig, UserConfig } from 'vite'
// Explicit .ts extension: a plugin's vite.config.ts is loaded through Node's ESM resolver, which
// requires the extension. Vite and tsc (allowImportingTsExtensions) both accept it too, so one form
// works in all three.
import { prefixCss } from '../css/prefixSelectors.ts'

/** Mirrors PluginManifestReader.IdPattern; see scripts/lib/plugin-rules.mjs. */
const ID_PATTERN = /^[a-z0-9]([a-z0-9.\-]{0,62})[a-z0-9]$/

/**
 * Specifiers the host publishes as ESM facades. A plugin must never bundle its own copy of any of
 * these: React must be one instance for hooks and context to work, react-router must be the host's
 * so `useNavigate` drives the host's router, and DevExtreme must be the host's copy or
 * `config({licenseKey})` does not apply and the plugin renders a trial watermark.
 *
 * Kept in sync with `frontend/src/plugin-runtime/sharedModules.ts` by a test in the host.
 */
export const SHARED_SPECIFIERS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-router',
  '@caxperts/toolkit-plugin-sdk',
] as const

/** DevExtreme widgets and data sources reach a plugin through the SDK, never directly. */
const SHARED_PREFIXES = ['@caxperts/toolkit-plugin-sdk/ui/', '@caxperts/toolkit-plugin-sdk/data/'] as const

/**
 * Imports that are always a mistake, turned into build failures. Each one has a runtime symptom
 * that looks like something else entirely, which is why they are caught here.
 */
const FORBIDDEN: { test: (id: string) => boolean; reason: string }[] = [
  {
    test: id => id === 'devextreme' || id.startsWith('devextreme/') || id.startsWith('devextreme-react'),
    reason:
      "import DevExtreme widgets from '@caxperts/toolkit-plugin-sdk/ui/<widget>' instead. A direct import " +
      'bundles a second DevExtreme copy, which has no license key and renders a trial watermark.',
  },
  {
    test: id => id === 'react-toastify',
    reason:
      "use the SDK's `toast` instead. A second react-toastify instance has no <ToastContainer />, " +
      'so its toasts never appear at all.',
  },
  {
    test: id => id === 'react-dom/client',
    reason:
      'a plugin must not create its own React root — the tree would mount outside every host ' +
      'provider (auth, theme, language, router). Export routes from definePlugin() instead.',
  },
  {
    test: id => id === 'react-oidc-context',
    reason: "use the SDK's `useAuth()`; the OIDC client is host-internal.",
  },
]

export interface ToolkitPluginOptions {
  /**
   * Must equal `plugin.json`'s id — it is the CSS scope class the host renders around the plugin.
   *
   * Optional: when omitted it is read from the `plugin.json` next to the Vite config, which is one
   * fewer place to spell the id. Pass it explicitly if your manifest lives somewhere else; that path
   * never touches the filesystem.
   */
  id?: string
  /** Dev-server proxy target for `/api`. Defaults to the host's dev port. */
  apiTarget?: string
  /**
   * Library entry. Defaults to `src/index.tsx`.
   *
   * Exposed because a Vite plugin's `config()` result merges OVER the user's config, so setting
   * `build.lib.entry` in your own `defineConfig` has no effect — without this option the default
   * could not be changed at all.
   */
  entry?: string
}

/**
 * Reads the id out of the manifest beside the Vite config.
 *
 * Resolved against Vite's own `config.root` rather than `process.cwd()`: root is what Vite actually
 * resolved, so this survives `vite build --root x` and being invoked from a repository root, whereas
 * cwd would silently read the wrong manifest — or none.
 */
function idFromManifest(root: string): string {
  const manifestPath = path.join(root, 'plugin.json')

  let raw: string
  try {
    raw = readFileSync(manifestPath, 'utf8')
  } catch {
    throw new Error(
      `toolkitPlugin(): no plugin.json at ${manifestPath}. Pass { id } explicitly, or add the manifest.`,
    )
  }

  let manifest: { id?: unknown }
  try {
    manifest = JSON.parse(raw) as { id?: unknown }
  } catch (error) {
    throw new Error(
      `toolkitPlugin(): ${manifestPath} is not valid JSON: ${(error as Error).message}`,
    )
  }

  if (typeof manifest.id !== 'string' || manifest.id.length === 0)
    throw new Error(`toolkitPlugin(): ${manifestPath} has no string "id". Pass { id } explicitly.`)

  return manifest.id
}

/**
 * The whole `vite.config.ts` of a plugin is `plugins: [toolkitPlugin()]`.
 */
export function toolkitPlugin(options: ToolkitPluginOptions = {}): Plugin[] {
  // Assigned in configResolved, which runs before generateBundle — the only hook that needs it.
  let wrapper: string | undefined

  const guard: Plugin = {
    name: 'toolkit-plugin:guards',
    enforce: 'pre',

    resolveId(id) {
      const forbidden = FORBIDDEN.find(rule => rule.test(id))
      if (forbidden) {
        this.error(`"${id}" must not be imported by a plugin: ${forbidden.reason}`)
      }
      return null
    },

    configResolved(config: ResolvedConfig) {
      const id = options.id ?? idFromManifest(config.root)

      // Validated before it becomes a class name: an id the host would reject produces a CSS scope
      // that can never match the wrapper the host renders, so the plugin loads with no styling at all
      // and nothing says why.
      if (!ID_PATTERN.test(id))
        throw new Error(
          `toolkitPlugin(): id "${id}" must match ${ID_PATTERN}. The host rejects any other id.`,
        )

      wrapper = `tk-plugin-${id}`
    },

    config(): UserConfig {
      return {
        // An inline (empty) PostCSS config stops Vite searching up the directory tree and picking
        // up the host repo's own Tailwind/PostCSS config, which would emit unrelated CSS into the
        // plugin bundle and warn about a missing `content` option.
        css: { postcss: {} },
        build: {
          lib: {
            entry: options.entry ?? 'src/index.tsx',
            formats: ['es'],
            fileName: () => 'index.js',
            // Fixed, not derived from the package name: plugin.json declares
            // frontend/style.css, and the host serves exactly the path it was told.
            cssFileName: 'style',
          },
          // Bare specifiers must survive into the output; the host's import map resolves them to
          // its own facades at runtime.
          rollupOptions: {
            external: (id: string) =>
              (SHARED_SPECIFIERS as readonly string[]).includes(id) ||
              SHARED_PREFIXES.some(prefix => id.startsWith(prefix)),
          },
          cssCodeSplit: false,
        },
        server: {
          proxy: { '/api': { target: options.apiTarget ?? 'http://localhost:5299', changeOrigin: true } },
        },
      }
    },
  }

  const scopeCss: Plugin = {
    name: 'toolkit-plugin:scope-css',
    // 'post' matters: Vite finalises the CSS asset in its own generateBundle, and without this the
    // hook below runs first and rewrites a placeholder instead of the real stylesheet — leaving the
    // shipped CSS unscoped, which is exactly the failure this plugin exists to prevent.
    enforce: 'post',

    // Applied to the generated bundle rather than per-module so `@keyframes` renaming sees the
    // whole stylesheet at once.
    generateBundle(_options, bundle) {
      // configResolved always runs first, so this is unreachable — but an unscoped stylesheet is
      // exactly the failure this plugin exists to prevent, and silently prefixing with "undefined"
      // would ship it.
      if (wrapper === undefined)
        this.error('toolkit-plugin:scope-css ran before the plugin id was resolved')

      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue
        // TextDecoder rather than Buffer: both work now that this package has @types/node for the
        // manifest read, but TextDecoder is typed by the DOM lib as well, so the CSS path stays
        // independent of whether a consumer's program includes the Node types.
        const source =
          typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source)
        file.source = prefixCss(source, { wrapper }).css
      }
    },
  }

  return [guard, scopeCss]
}
