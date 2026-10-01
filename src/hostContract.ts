/**
 * The exact surface the host publishes to plugins at runtime.
 *
 * `frontend/src/plugin-runtime/sdkConformance.ts` assigns the host's implementation to this type,
 * so renaming or re-typing anything the host exposes fails the host's own `tsc -b` — before a
 * partner discovers it at runtime.
 */
import type { ComponentType, ReactNode } from 'react'
// One-directional: types.ts does not import from here, so naming the icon union costs no cycle.
import type { PluginIconName } from './types.ts'

export interface PluginUser {
  id: number
  name: string | null
  email: string
  groups: readonly string[]
}

export interface PluginAuth {
  isAuthenticated: boolean
  user: PluginUser | null
}

export interface PluginTheme {
  /** Active theme id. */
  theme: string
  /**
   * Vienna needs inverted styling in places. Branch on this and apply a `.vienna-*` class rather
   * than hardcoding colours — see REQUIRED_DOCS/THEMING.md.
   */
  isVienna: boolean
}

export interface PluginHttpConfig {
  params?: Record<string, unknown>
  headers?: Record<string, string>
  signal?: AbortSignal
  timeout?: number
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer'
  onUploadProgress?: (event: { loaded: number; total?: number }) => void
}

/**
 * Every call must target a same-origin `/api/…` path. Not a security boundary — plugin code runs
 * in the host origin and can call `fetch` directly — but it stops the most likely accident, which
 * is handing the user's bearer token to a third-party URL.
 */
export interface PluginHttp {
  get<T = unknown>(path: string, config?: PluginHttpConfig): Promise<T>
  post<T = unknown>(path: string, body?: unknown, config?: PluginHttpConfig): Promise<T>
  put<T = unknown>(path: string, body?: unknown, config?: PluginHttpConfig): Promise<T>
  patch<T = unknown>(path: string, body?: unknown, config?: PluginHttpConfig): Promise<T>
  delete<T = unknown>(path: string, config?: PluginHttpConfig): Promise<T>
}

/**
 * A plugin's own API surface, with the `/api/plugins/{id}` prefix supplied by the host.
 *
 * The host's route convention forces every plugin controller under that prefix, so it is not a choice
 * a plugin makes — and writing it out by hand is the one place the plugin id is duplicated where a
 * mistake is neither a build error nor an install error, just a 404 at runtime.
 */
export interface PluginApi {
  /**
   * This plugin's id, or `null` when the calling component renders outside a plugin page — which
   * cannot happen for a route element, but can for anything the host renders in its own shell.
   */
  readonly id: string | null
  /**
   * `/api/plugins/{id}` joined with the segments given. Throws when {@link id} is `null`.
   *
   * For {@link http} and anything else that goes through the host's HTTP client. It is deliberately
   * NOT deployment-prefixed — the client adds the prefix itself, so prefixing here would double it.
   *
   * **Use {@link url} instead for anything the browser fetches directly** — an `EventSource`, a
   * download `href`, a bare `fetch`, a DevExtreme `loadUrl`/`uploadUrl`. Under path-based
   * multi-tenancy this path is missing the `/instance1` those need, and the resulting 404 shows up
   * only in a multi-tenant deployment.
   */
  path(...segments: (string | number)[]): string
  /**
   * {@link path}, plus the prefix this deployment is served under — the browser-ready URL.
   *
   * Use this for every URL the browser requests without going through {@link http}: an
   * `EventSource`, an `<a href>` download, a direct `fetch`, a DevExtreme `CustomStore.loadUrl` or
   * `FileUploader.uploadUrl`. Identical to {@link path} in a single-tenant deployment, which is why
   * getting it wrong is invisible until someone runs several instances on one domain
   * (REQUIRED_DOCS/MULTI_TENANCY_NET.md). Throws when {@link id} is `null`.
   */
  url(...segments: (string | number)[]): string
  /**
   * {@link PluginHttp}, with a relative path resolved against this plugin's prefix.
   *
   * A path that already starts with `/api/` is passed through unchanged, so this is a strict superset
   * of the bare `http`: anything reachable there is reachable here.
   */
  readonly http: PluginHttp
}

export interface PluginToast {
  success(message: string): void
  error(message: string): void
  info(message: string): void
  warning(message: string): void
}

/** Resolves `{pluginId}.{key}` first, then a bare `{key}`, then returns the key itself. */
export type PluginTranslate = (key: string, fallback?: string) => string

export interface PluginIconProps {
  /**
   * A host icon name. The union gives completions for the twenty the host ships; the `string` arm
   * keeps any other value accepted, because an unknown name renders the generic fallback icon rather
   * than failing — a typo must not be able to produce an invisible, unclickable row.
   */
  name?: PluginIconName | (string & {})
  path?: string
  size?: number
  className?: string
}

/**
 * The host-side surface. Kept narrow on purpose: `apiClient` itself, `tokenStore`, the internal
 * `services/` modules, `react-oidc-context`, `logout`, `setLanguage` and the theme setters are all
 * deliberately withheld — see REQUIRED_DOCS/PLUGINS.md.
 */
export interface PluginHostSurface {
  useAuth(): PluginAuth
  useTheme(): PluginTheme
  useT(): PluginTranslate
  useDictionary(): Record<string, string>
  /** This plugin's own API prefix and a client bound to it. See {@link PluginApi}. */
  usePluginApi(): PluginApi
  http: PluginHttp
  toast: PluginToast
  Icon: ComponentType<PluginIconProps>
  /** Wraps children in the host's error boundary; useful around risky plugin subtrees. */
  ErrorBoundary: ComponentType<{ children: ReactNode; fallback?: ReactNode }>
}
