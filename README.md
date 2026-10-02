# @caxperts/toolkit-plugin-sdk

The Toolkit plugin kit: the frontend SDK **and** the scripts that scaffold, validate and package a
plugin. A plugin ships as one folder with a frontend half, a `server/` .NET half, or both.

Full contract, trust model and packaging rules: [github.com/caxperts/Toolkit.Plugins.Examples](https://github.com/caxperts/Toolkit.Plugins.Examples).

## Steps to create a plugin

### 1. Install the SDK

Released versions are on [npmjs.com](https://www.npmjs.com/package/@caxperts/toolkit-plugin-sdk),
versioned like the host release they belong to (`2026.4.0` for host 2026.4.0):

```bash
npm i -D @caxperts/toolkit-plugin-sdk@2026.4.0
```

If you were given a tarball from a build instead (an unreleased version is only ever a pipeline
artifact), install that: `npm i -D ./caxperts-toolkit-plugin-sdk-2026.4.0.tgz`.

### 2. Scaffold the plugin

`toolkit-new-plugin` writes a full-stack plugin (a frontend page plus a `server/` .NET project with its
own `plg_` schema, migration and controllers) with the id already correct everywhere the host
cross-checks it. Pass `--frontend-only` for just the frontend half.

```bash
npx toolkit-new-plugin --id acme.inspections --name "ACME Inspections" --dir ./acme.inspections
cd acme.inspections
```

The scaffolder prints the exact `npm install` / `validate` / `typecheck` commands to run next.

### 3. Install dependencies

Run `npm install` in the new folder. Every dependency is type-only — the build externalises the SDK,
React and DevExtreme, so the output is identical with or without them.

### 4. (Backend only) Check the SDK version

The scaffolded backend references one NuGet package,
[`CAXperts.Toolkit.Plugins.Abstractions`](https://www.nuget.org/packages/CAXperts.Toolkit.Plugins.Abstractions),
from nuget.org — the scaffolded `nuget.config` already points there. Its version is
`PluginSdkPackageVersion` in `Directory.Build.props`; it must match the npm SDK and the host you
build against. Skip this step if you scaffolded `--frontend-only`.

### 5. Declare the plugin

`src/index.tsx` calls `definePlugin({ id, name, apiVersion, routes, menu })`; the `id` must equal
`plugin.json`'s id. Everything else derives from that id — the `/api/plugins/<id>/` prefix, the CSS
scope, and the translation keys.

### 6. Build your page

Write React in `src/<Name>Page.tsx` using the host-provided hooks — `useAuth`, `useTheme`, `useT`,
`useDictionary`, `usePluginApi`, plus `http`, `toast`, `Icon` and `ErrorBoundary`. Call your own API
through `usePluginApi()` (`api.http.get('status')` → `/api/plugins/<id>/status`) rather than writing the
prefix by hand.

### 7. Style with theme variables

Write ordinary CSS in `src/styles.css`; the build prefixes every selector with `.tk-plugin-<id>` so
nothing leaks into the host. Never use a literal colour — only `var(--system-*)` / `var(--*-gradient)`,
which keeps the page readable in both Dark and Vienna (see the [GitHub repository](https://github.com/caxperts/Toolkit.Plugins.Examples)).

### 8. (Backend only) Own your data

Give your `DbContext` its own `plg_<id>` schema and a hand-written migration, and key every row on the
OIDC `subject` (via `PluginControllerBase.TryGetSubject`) — never `ICurrentUser.Id`, which is `0` for
every real user. Put the owner in the `WHERE` clause of every read and delete so two users sharing a
table cannot see each other's rows.

### 9. Validate and typecheck

Run both before building — they need no build output, so a manifest typo or a wrong `definePlugin`
shape costs a second instead of a full build. Skipping typecheck turns a compile error into a runtime
rejection by the host's loader.

```bash
npm run validate     # manifest / menu / translations / migration
npm run typecheck    # tsc --noEmit against the SDK's types
```

### 10. Build

`npm run build` builds the frontend to `dist/`; on a full-stack plugin use `npm run build:all`, which
also runs `dotnet publish` into `backend/`.

### 11. Test locally

`npm run stage` builds and expands the plugin into `.plugins-dev/<id>/`, where the running host picks it
up. Frontend changes need a re-stage and a page reload; a backend change also needs an API restart,
because the assembly is never unloaded once loaded.

### 12. Package and install

`npm run pack` produces `<id>-<version>.zip`. An **Admin** installs it through **Settings → Plugins**
(the `POST api/settings/plugins` endpoint); the same page removes it.

## Rules the build enforces for you

These are not optional and the build/loader rejects violations, so they are worth knowing up front:

- **Never add `react`, `react-dom` or `devextreme` as real dependencies.** The host publishes its own
  instances through an import map; a second React breaks hooks and a second DevExtreme renders a trial
  watermark. Router primitives come from `react-router` directly (the host publishes that too).
- **Four imports are build errors:** `devextreme*` directly, `react-toastify`, `react-dom/client`, and
  `react-oidc-context`. Each has a runtime symptom that looks like something else, so the build stops
  them early.
- **DevExtreme widgets** come from `@caxperts/toolkit-plugin-sdk/ui/<widget>` and data sources from
  `@caxperts/toolkit-plugin-sdk/data/<store>`, both externalised to the host's copy. To get types, add
  `devextreme@26.1.3 devextreme-react@26.1.3` as devDependencies (pinned to the host's version).
- **All user-facing text goes through `useT()`**, which resolves `{id}.{key}` → `{key}` → the key, so a
  plugin reusing a host word like `Save` gets the existing translation for free.

## Reference

- Full contract, security/stability model, database and packaging rules:
  [github.com/caxperts/Toolkit.Plugins.Examples](https://github.com/caxperts/Toolkit.Plugins.Examples).
- Worked full-stack example and living style guide: [`example-hello/`](https://github.com/caxperts/Toolkit.Plugins.Examples/tree/main/example-hello).
- `http` only accepts same-origin `/api/…` paths — a guard rail against leaking the bearer token, **not**
  a security boundary (plugin code runs in the host origin and can call `fetch` directly).

## License

The plugin SDK — this npm package and the `CAXperts.Toolkit.Plugins.Abstractions` NuGet package — is
released under the [MIT License](https://github.com/caxperts/Toolkit.Plugins.Examples/blob/main/LICENSE). The license covers the SDK only, not the Toolkit host.
