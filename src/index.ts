/**
 * `@caxperts/toolkit-plugin-sdk` — everything a frontend plugin may import from the host.
 *
 * At BUILD time this resolves to the type declarations below. At RUNTIME the host's import map
 * points the same specifier at its own ESM facade, so a plugin always runs against the host's
 * single React / react-router / DevExtreme instances.
 */
export { definePlugin, PLUGIN_API_VERSION } from './types.ts'
export type { PluginDefinition, PluginRoute, PluginMenuItem, PluginIconName } from './types.ts'

export type {
  PluginApi,
  PluginAuth,
  PluginHttp,
  PluginHttpConfig,
  PluginHostSurface,
  PluginIconProps,
  PluginTheme,
  PluginToast,
  PluginTranslate,
  PluginUser,
} from './hostContract.ts'

// Ambient on purpose: these have no implementation HERE. The plugin build marks
// '@caxperts/toolkit-plugin-sdk' external, so this module body never ships, and at runtime the host's
// import map resolves the specifier to its own facade — which is where the real functions live.
// `frontend/src/plugin-runtime/sdkConformance.ts` checks that facade against PluginHostSurface,
// so the two cannot drift.
import type { PluginHostSurface } from './hostContract.ts'

export declare const useAuth: PluginHostSurface['useAuth']
export declare const useTheme: PluginHostSurface['useTheme']
export declare const useT: PluginHostSurface['useT']
export declare const useDictionary: PluginHostSurface['useDictionary']
export declare const usePluginApi: PluginHostSurface['usePluginApi']
export declare const http: PluginHostSurface['http']
export declare const toast: PluginHostSurface['toast']
export declare const Icon: PluginHostSurface['Icon']
export declare const ErrorBoundary: PluginHostSurface['ErrorBoundary']

// Router primitives are NOT re-exported here. `react-router` is published as its own facade, so a
// plugin imports `useNavigate`, `Link` and friends straight from 'react-router' and gets the host's
// instance — routing against the host's own BrowserRouter. Re-exporting them through the SDK would
// only add a second name for the same thing.
