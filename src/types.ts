import type { ReactNode } from 'react'

/**
 * Contract version this SDK implements. Must equal the host's `PluginApiVersion.Current` and the
 * `apiVersion` in the package's `plugin.json`; a mismatch makes the host report the plugin as
 * incompatible instead of loading it against rules it does not know.
 */
export const PLUGIN_API_VERSION = 1

/**
 * Icons are a named set the HOST owns, so a plugin cannot smuggle markup into the shell. Use
 * `iconPath` for anything outside this list.
 */
export type PluginIconName =
  | 'extension'
  | 'clipboard'
  | 'chart'
  | 'checklist'
  | 'document'
  | 'folder'
  | 'gear'
  | 'grid'
  | 'info'
  | 'layers'
  | 'link'
  | 'list'
  | 'lock'
  | 'map'
  | 'people'
  | 'search'
  | 'star'
  | 'tag'
  | 'timer'
  | 'warning'

export interface PluginMenuItem {
  /** Route relative to `/plugins/{id}/`. Empty string is the plugin's root page. */
  path: string
  /** Shown in the sidebar. Pass a translated string — `useT()` is available in components. */
  label: string
  icon?: PluginIconName
  /**
   * The `d` attribute of a 24x24 SVG path, rendered inside the host's own
   * `<svg fill="currentColor">`. Safe by construction and themes itself — unlike an arbitrary SVG
   * string, it cannot carry `<script>` or `<foreignObject>`.
   */
  iconPath?: string
  /** `nav` (default) puts it in the main navigation; `admin` groups it under Settings. */
  section?: 'nav' | 'admin'
  /** Lower sorts first within its section. Ties fall back to label order. */
  order?: number
}

export interface PluginRoute {
  /** Relative to `/plugins/{id}/`. Empty string is the index route. May contain `:params`. */
  path: string
  /** `element`, not `component`, matching the host's own route table. */
  element: ReactNode
}

export interface PluginDefinition {
  /** Must equal `plugin.json`'s id — the host rejects a mismatch. */
  id: string
  name: string
  apiVersion: number
  routes: PluginRoute[]
  menu?: PluginMenuItem[]
}

/**
 * Identity function. It exists purely so authors get inference and errors at the definition site
 * rather than a silent shape mismatch discovered by the loader at runtime.
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition
}
