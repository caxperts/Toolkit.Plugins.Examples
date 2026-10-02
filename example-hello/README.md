# Hello World — example Toolkit plugin

The reference plugin — **full-stack**, and the only example. Copy this folder to start a new one.

Both halves live here and one `plugin.json` describes them: the frontend in `src/`, the backend in
`server/`, and the DBA script in `migrations/`. The folder is deliberately self-contained, so it can
be handed to a partner as it stands.

Full contract: [github.com/caxperts/Toolkit.Plugins.Examples](https://github.com/caxperts/Toolkit.Plugins.Examples).

## Build

```bash
cd plugin-kit/example-hello
npm install
npm run build          # frontend only -> dist/index.js + dist/style.css
npm run build:server   # backend only  -> backend/Example.Hello.dll (dotnet publish)
npm run pack           # both halves, then package -> hello-1.1.1.zip, ready to upload
npm run stage          # both halves, expanded into ../../.plugins-dev/hello/ for local dev
```

`npm run pack` builds before packaging on purpose: `plugin.json` declares
`entryAssembly: backend/Example.Hello.dll` and the packer checks the file is really there, so a stale
or frontend-only tree fails here instead of producing a package the host rejects on upload.

`npm run dev` is `vite build --watch` (frontend only); re-stage and reload the page to see changes.
A backend change needs `npm run stage` and an API restart — the assembly is loaded into the running
process and is never unloaded.

## What to notice

**Every frontend devDependency here is type-only.** `react-router`, `devextreme` and
`devextreme-react` are installed so `npm run typecheck` has their `.d.ts` files, and `react` arrives as
react-router's peer — but the build externalises every one of them, so `dist/index.js` is
**byte-identical** with or without them. The host supplies all of it at runtime through its import
map, which is what keeps this bundle a couple of kilobytes and makes a second copy of React (broken
hooks, unreadable context) or of DevExtreme (a trial watermark) impossible.

The minimum for a plugin that imports neither the router nor a DevExtreme widget is just
`@types/react`. Add the rest only for what you actually import — `devextreme`/`devextreme-react` are
what type `@caxperts/toolkit-plugin-sdk/ui/*` and `/data/*`, and they are optional peers of the SDK, so nothing
installs them for you. Pin the host's version, or the types describe props the host's widgets do not
have.

**`tsconfig.json` is four lines.** It extends `@caxperts/toolkit-plugin-sdk/tsconfig.plugin.json`, which carries
everything load-bearing: the module resolution that reads the SDK's `exports` map (nothing else
resolves `ui/*`), the JSX runtime Vite's own transform also reads, and the TS-source import rules the
SDK needs. Run `npm run typecheck` — without it, a wrong `definePlugin` shape is a runtime rejection by
the loader rather than an error where you wrote it.

**`npm run validate` needs no build.** It runs the same manifest, migration and menu checks
`npm run pack` does, in about a second, so a typo in `plugin.json` does not cost a `vite build` plus a
`dotnet publish` to discover.

**`vite.config.ts` is four lines.** The preset does the rest, including turning four
always-wrong imports into build errors: `devextreme*` directly, `react-toastify`,
`react-dom/client`, and `react-oidc-context`. Each of those has a runtime symptom that looks like
something else entirely, which is why they fail the build instead.

**`hello.css` is ordinary CSS.** The build prefixes every selector with `.tk-plugin-hello`, rewrites
`:root`/`html`/`body` to that wrapper and namespaces `@keyframes`, so nothing here can leak into the
host — not even a `.header` or `.dx-datagrid` rule. Use the host's theme variables and never a
literal colour, and the page is readable in Dark and Vienna with no conditional rules.

**Every label goes through `useT()`**, which resolves `hello.{key}` → `{key}` → the key. The keys in
`plugin.json`'s `translations` are seeded into the host's `StandardTranslations` at install, so a
customer can correct a translation in Settings → Languages and an update will not overwrite their
fix.

**Router primitives come from `react-router`**, not from the SDK — the host publishes it as a facade,
so `useNavigate` drives the host's own `BrowserRouter` and navigation does not reload the page.

**The SDK's hooks are referentially stable.** `useAuth()`, `useTheme()` and `useT()` return the same
value until the underlying data changes, so you may put `user` or `t` straight into a dependency
array. Do not mirror them into state with an effect anyway: `HelloPage` derives instead of
duplicating, and gives DevExtreme a memoised `dataSource`, because a new array in JSX re-initialises
the widget on every render.

**The backend assembly is `Example.Hello`, not `Toolkit.Hello`.** The loader delegates any assembly
whose name starts with a host-owned prefix (`System.`, `Microsoft.`, `Toolkit.`, `Azure.`, …) to the
host's own load context, so a plugin using one of those prefixes breaks as soon as anything resolves
it by name. Pick a prefix of your own.

**Rows are owned by a user, and the owner comes from the authenticated principal.**
`GreetingsController` reads the OIDC `sub` claim, never the request body, and both the read and the
delete filter on it — so two users sharing one plugin table cannot see or remove each other's rows.
There is no fallback user: an unidentifiable caller is an error, not a default.

**Do not use `ICurrentUser.Id`.** It parses the subject claim as an `int`, and a Keycloak subject is a
GUID, so it is 0 for every real user. This controller originally keyed ownership on it and rejected a
zero id as unauthenticated, which answered 401 to every authenticated request. `ICurrentUser` is still
the right source for `Email` and `Groups`, and now carries `Subject` as well.

**`GreetingsController` derives from `PluginControllerBase`**, so reading the owner is
`if (!TryGetSubject(out var subject)) return NoSubject();` rather than eight lines of claim reading in
every plugin. Outside a controller, `User.GetSubject()` from `PluginPrincipal` does the same.

**`usePluginApi()` supplies the `/api/plugins/hello/` prefix.** `HelloPage` used to hardcode it as a
string — the only place the id was duplicated where a mistake is neither a build error nor an install
error, just a 404. `api.http.get('greetings')` and `api.path('greetings', id)` derive it; a full `/api/…`
path still works, so calling the rest of the product needs nothing else. For a URL the **browser**
fetches itself — an `EventSource`, a download `href`, a DevExtreme `loadUrl` — use `api.url(…)`
instead: it adds the deployment's path prefix, which `api.http` supplies on its own. The two are
identical until the product is deployed as several instances under subpaths.

**`migrations/001_plg_hello.sql` is generated, not hand-written.** `PluginMigrationScriptTests` asserts it
equals what EF produces from the migration in `HelloDbContext.cs`, so the two cannot drift. `dotnet ef
migrations script` cannot produce it — see PLUGINS.md for why, and for the in-process recipe that does.

**Seeding data uses `migrationBuilder.InsertData(schema: …)`, never `migrationBuilder.Sql`.** The host
refuses raw SQL in a plugin migration because it cannot verify the schema it touches; `InsertData` carries
its schema in a property the guard reads. You can also check the whole boundary yourself, offline, with
`PluginSchemaValidator.Validate` in your own test — no database needed.

## Files

| File | Purpose |
|---|---|
| `plugin.json` | Manifest for BOTH halves: id, version, `apiVersion`, `entryAssembly`, `database.schema`, frontend entry, menu, translations. |
| `tsconfig.json` | Four lines: extends the SDK's `tsconfig.plugin.json`. Without it there is no typechecking at all. |
| `vite.config.ts` | The SDK preset, with no `id` — it reads the manifest. |
| `src/index.tsx` | `definePlugin()` — routes and menu. |
| `src/HelloPage.tsx` | Exercises hooks, auth, theme, i18n, toasts, a DataGrid, the router, and the plugin's own API via `usePluginApi()`. |
| `src/ReportPage.tsx` | A second route, with a URL param. |
| `src/hello.css` | Theme-variable-only styling. |
| `Directory.Build.props` | The build settings the backend cannot inherit from `backend/`. Copy it with `server/`. |
| `server/Example.Hello.csproj` | The backend template. Outside this repo its three `ProjectReference`s collapse into the ONE `PackageReference` the csproj spells out — `CAXperts.Toolkit.Plugins.Abstractions` carries all three assemblies. |
| `server/HelloPlugin.cs` | `IToolkitPlugin` + `IPluginMigrations` + `IPluginStartup`; registers the plugin's `DbContext`. |
| `server/HelloDbContext.cs` | `plg_hello.Greetings` and its hand-written EF migration. |
| `server/Controllers/StatusController.cs` | An anonymous `ping` and an authenticated `me`, showing how the route convention applies. |
| `server/Controllers/GreetingsController.cs` | CRUD over the plugin's own table, with rows owned by the OIDC `sub` claim. |
| `migrations/001_plg_hello.sql` | Idempotent equivalent for customers where a DBA applies schema changes. |

## Endpoints

The host's route convention forces the `api/plugins/{id}` prefix and a default `[Authorize]` on every
plugin action, so none of these declare either.

| Method | Path | Auth |
|---|---|---|
| `GET` | `api/plugins/hello/status/ping` | anonymous (explicit `[AllowAnonymous]`) |
| `GET` | `api/plugins/hello/status/me` | required |
| `GET` | `api/plugins/hello/status/events` | anonymous — Server-Sent Events, via `PluginSse` |
| `GET` | `api/plugins/hello/greetings` | required — this user's rows, capped at 50 |
| `POST` | `api/plugins/hello/greetings` | required |
| `DELETE` | `api/plugins/hello/greetings/{id}` | required — only your own row |
