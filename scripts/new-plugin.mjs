#!/usr/bin/env node
/*
 * Scaffolds a new Toolkit plugin — a full-stack one by default, or a frontend-only one with
 * --frontend-only.
 *
 * The documented way to start used to be "copy plugin-kit/example-hello/", a 200-line living style guide
 * with a full backend attached, and then substitute the id in every place it has to appear. This emits
 * the smallest thing that validates, typechecks and packages, with the id already correct in all three
 * halves the host cross-checks (plugin.json, the frontend bundle, and — for a backend — the assembly).
 *
 * Usage:
 *   node scripts/new-plugin.mjs --id acme.inspections [--name "ACME Inspections"] [--dir <path>]
 *                               [--frontend-only] [--force]
 *
 * Options:
 *   --id <id>         Plugin id. Must match the host's id pattern and not be reserved. Required.
 *   --name <name>     Display name. Defaults to a title-cased form of the id.
 *   --dir <path>      Target directory. Defaults to plugins/<id>.
 *   --frontend-only   Emit only the frontend half — no server/, no schema, no migration.
 *   --force           Write into a non-empty directory.
 *
 * The backend it emits is the same shape as plugin-kit/example-hello/server/, but wired for a PARTNER:
 * the host SDK arrives as ONE PackageReference from nuget.org (a partner has the public npm/NuGet
 * packages, not this repository — and that package carries Toolkit.Data and Toolkit.Domain inside it),
 * and nuget.config pins nuget.org as the only source. Inside this repository that backend builds only
 * once the referenced version is on nuget.org, which is deliberate: example-hello is the in-repo,
 * source-referenced build, and this is the partner template.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  ID_PATTERN,
  RESERVED_IDS,
  SCHEMA_PATTERN,
  SDK_PACKAGE_VERSION,
  SUPPORTED_API_VERSION,
} from './lib/plugin-rules.mjs'

function fail(message) {
  console.error(`new-plugin: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { force: false, frontendOnly: false }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--id':
        args.id = argv[++i]
        break
      case '--name':
        args.name = argv[++i]
        break
      case '--dir':
        args.dir = argv[++i]
        break
      case '--frontend-only':
        args.frontendOnly = true
        break
      case '--force':
        args.force = true
        break
      default:
        fail(`unknown argument "${argv[i]}"`)
    }
  }
  if (!args.id) fail('--id <id> is required')
  return args
}

/**
 * "acme.inspections" -> "Acme Inspections". Only a default for --name, so it does not have to be clever;
 * it has to produce something a human would then correct rather than something that looks deliberate.
 */
const titleCase = id =>
  id
    .split(/[.\-]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

/** A PascalCase identifier with no separators — the frontend component and the C# class prefix. */
const pascalCase = id =>
  id
    .split(/[.\-]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

/** A dotted PascalCase name — the assembly name and root namespace, e.g. "Acme.Inspections". */
const pascalDotted = id =>
  id
    .split(/[.\-]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('.')

/**
 * Any assembly whose simple name starts with one of these is delegated to the host's OWN load context
 * by PluginLoadContext.IsHostOwned. The entry assembly survives being loaded by path, but the moment
 * anything resolves it by NAME the host is asked for an assembly it does not have and the load fails.
 * A partner's id is normally its own namespace, so this only trips on a genuinely bad choice.
 */
const HOST_OWNED_PREFIXES = ['Toolkit.', 'System.', 'Microsoft.', 'Azure.', 'Swashbuckle.']

function main() {
  const args = parseArgs(process.argv.slice(2))
  const { id } = args
  const backend = !args.frontendOnly

  // The same rules pack-plugin and the host apply, from the same constants — so a scaffold can never
  // produce a plugin the packer then rejects.
  if (!ID_PATTERN.test(id)) fail(`id "${id}" must match ${ID_PATTERN}`)
  if (RESERVED_IDS.has(id)) fail(`id "${id}" is reserved by the host`)

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
  const kitDir = path.resolve(scriptsDir, '..')
  const repoRoot = path.resolve(kitDir, '..')
  const targetDir = path.resolve(args.dir ?? path.join(repoRoot, 'plugins', id))
  const name = args.name ?? titleCase(id)
  const component = `${pascalCase(id)}Page`

  // Backend-only derivations, and their guards. Both mirror a rule the host enforces at load; failing
  // here means the author never ships a package that trips it.
  const cls = pascalCase(id)
  const assembly = pascalDotted(id)
  const schema = `plg_${id.replaceAll('.', '_').replaceAll('-', '_')}`

  if (backend) {
    if (HOST_OWNED_PREFIXES.some(prefix => `${assembly}.`.startsWith(prefix)))
      fail(
        `id "${id}" derives the assembly name "${assembly}", which starts with a host-owned prefix ` +
          `(${HOST_OWNED_PREFIXES.join(', ')}). The loader would delegate it to the host and fail. ` +
          'Pick an id in your own namespace, or pass --frontend-only.',
      )
    if (!SCHEMA_PATTERN.test(schema))
      fail(
        `id "${id}" derives the schema "${schema}", which does not match ${SCHEMA_PATTERN} ` +
          '(a plg_ name of at most 50 characters). Shorten the id, or pass --frontend-only.',
      )
  }

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0 && !args.force)
    fail(`${targetDir} is not empty. Pass --force to write into it anyway.`)

  // Computed rather than hardcoded as ../../plugin-kit, so --dir outside plugins/ still produces working
  // package scripts and a resolvable SDK dependency.
  const toScripts = path.relative(targetDir, scriptsDir).replaceAll(path.sep, '/') || '.'
  const toSdk = path.relative(targetDir, kitDir).replaceAll(path.sep, '/')

  // --- plugin.json ---------------------------------------------------------
  const manifest = {
    id,
    name,
    version: '1.0.0',
    apiVersion: SUPPORTED_API_VERSION,
    publisher: 'TODO: your organisation',
    // A backend half declares the assembly the host loads and the schema it owns. Both are checked at
    // install; the assembly must exist under backend/ once `npm run build:all` has published it.
    ...(backend ? { entryAssembly: `backend/${assembly}.dll`, database: { schema } } : {}),
    frontend: {
      entry: 'frontend/index.js',
      css: ['frontend/style.css'],
      // The menu entry is what seeds a PageAccess row, so an admin can toggle this page like any
      // built-in one. The label is a translation key, and it is translated below.
      menu: [{ path: '', label: `${id}.${name}`, icon: 'extension', section: 'nav', order: 50 }],
    },
    // Every key must start with "{id}." or the host rejects the package — that is what stops a plugin
    // overwriting a host string such as "Save". A key the host already has (like "Loading...") can be
    // used unprefixed from code and resolves against the host dictionary.
    translations: { 'en-US': { [`${id}.${name}`]: name } },
  }

  // --- package.json --------------------------------------------------------
  const packageScripts = {
    build: 'vite build',
    dev: 'vite build --watch',
    ...(backend
      ? {
          'build:server': 'dotnet publish server -c Release -o backend',
          'build:all': 'npm run build && npm run build:server',
        }
      : {}),
    validate: `node ${toScripts}/pack-plugin.mjs --plugin . --check`,
    typecheck: 'tsc --noEmit',
    pack: backend
      ? `npm run build:all && node ${toScripts}/pack-plugin.mjs --plugin .`
      : `npm run build && node ${toScripts}/pack-plugin.mjs --plugin .`,
    stage: backend
      ? `npm run build:all && node ${toScripts}/pack-plugin.mjs --plugin . --stage`
      : `npm run build && node ${toScripts}/pack-plugin.mjs --plugin . --stage`,
  }

  const packageJson = {
    name: `@toolkit-plugins/${id}`,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: packageScripts,
    devDependencies: {
      // Type-only, every one of them: the build externalises the SDK and React, so the output is the
      // same with or without. Add devextreme/devextreme-react (pinned to the host's version) when you
      // import a widget from @caxperts/toolkit-plugin-sdk/ui/*, and react-router when you use the router.
      '@caxperts/toolkit-plugin-sdk': `file:${toSdk}`,
      '@types/react': '^19.2.7',
      typescript: '^6.0.3',
      vite: '^8.1.5',
    },
  }

  // --- the always-frontend files ------------------------------------------
  const files = {
    'plugin.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,

    'tsconfig.json': `{
  // Everything load-bearing comes from the base: the module resolution that reads the SDK's exports map
  // (nothing else resolves @caxperts/toolkit-plugin-sdk/ui/*), the JSX runtime Vite's transform also reads, and
  // the TS-source import rules the SDK needs. See plugin-kit/tsconfig.plugin.json for why each is there.
  "extends": "@caxperts/toolkit-plugin-sdk/tsconfig.plugin.json",
  "include": ["src"]
}
`,

    'vite.config.ts': `import { defineConfig } from 'vite'
import { toolkitPlugin } from '@caxperts/toolkit-plugin-sdk/vite'

// The whole build. No \`id\` argument: the preset reads it from plugin.json next to this file. The preset
// also externalises every shared specifier, prefixes your CSS with .tk-plugin-${id}, sets up the /api dev
// proxy, and turns four always-wrong imports into build errors.
export default defineConfig({
  plugins: [toolkitPlugin()],
})
`,

    'src/index.tsx': `import { definePlugin, PLUGIN_API_VERSION } from '@caxperts/toolkit-plugin-sdk'
import { ${component} } from './${component}'
import './styles.css'

export default definePlugin({
  // Must equal plugin.json's id — the host rejects a mismatch, and pack-plugin checks the built bundle
  // mentions it. Everything else derives from it: the API prefix, the CSS scope, the translation keys.
  id: '${id}',
  name: '${name}',
  apiVersion: PLUGIN_API_VERSION,
  routes: [{ path: '', element: <${component} /> }],
  menu: [{ path: '', label: '${name}', icon: 'extension', section: 'nav', order: 50 }],
})
`,

    [`src/${component}.tsx`]: frontendPage({ component, name, id, backend }),

    'src/styles.css': `/*
 * Ordinary CSS. The build prefixes every selector with .tk-plugin-${id}, rewrites :root/html/body to that
 * wrapper and namespaces @keyframes, so nothing here can leak into the host.
 *
 * Not one literal colour: every value is a host theme variable, which is what makes this readable in both
 * the Dark and Vienna themes with no conditional rules. See REQUIRED_DOCS/THEMING.md.
 */
.plugin-page {
  color: var(--system-font-color);
  background: var(--system-background-primary);
  padding: 24px;
}

.plugin-title {
  color: var(--system-font-color);
  font-size: 20px;
  margin: 0 0 12px;
}

.plugin-line {
  color: var(--system-color-gray-text-color);
  margin: 0 0 8px;
}
`,

    '.gitignore': backend
      ? `dist/
backend/
node_modules/
bin/
obj/
*.zip
`
      : `dist/
backend/
node_modules/
*.zip
`,

    'README.md': readme({ id, name, backend, assembly, schema }),
  }

  // --- the backend files ---------------------------------------------------
  if (backend) Object.assign(files, backendFiles({ id, cls, assembly, schema }))

  for (const [relativePath, content] of Object.entries(files)) {
    const absPath = path.join(targetDir, relativePath)
    mkdirSync(path.dirname(absPath), { recursive: true })
    writeFileSync(absPath, content)
  }

  const shown = path.relative(process.cwd(), targetDir).replaceAll(path.sep, '/') || '.'

  console.log(
    `new-plugin: created ${Object.keys(files).length} files in ${shown} ` +
      `(${backend ? 'full-stack' : 'frontend-only'})`,
  )
  console.log('\nNext:')
  console.log(`  npm --prefix ${shown} install`)
  console.log(`  npm --prefix ${shown} run validate`)
  console.log(`  npm --prefix ${shown} run typecheck`)
  if (backend) console.log(`  npm --prefix ${shown} run build:all`)
}

/**
 * The page component. Frontend-only gets a page that renders identity and stops there — there is no
 * backend for it to call, and a call that 404s on load would read as a bug. Full-stack gets a page that
 * actually calls its own `status` endpoint, which is what makes the scaffold a working demonstration
 * rather than two halves that have never met.
 */
function frontendPage({ component, name, id, backend }) {
  if (!backend)
    return `import { useCallback, useEffect, useState } from 'react'
import { toast, useAuth, usePluginApi, useT, useTheme } from '@caxperts/toolkit-plugin-sdk'

interface Status {
  ok: boolean
}

export function ${component}() {
  const t = useT()
  const { user, isAuthenticated } = useAuth()
  const { isVienna } = useTheme()

  // The plugin's own API. \`api.http\` takes paths relative to /api/plugins/${id}/, which the host's route
  // convention forces on every plugin controller — so the prefix is never written by hand. A full
  // /api/… path still works, for calling other parts of the product.
  const api = usePluginApi()

  const [status, setStatus] = useState<Status | null>(null)
  // "Loading" and "empty" must not look the same, or a failure reads as no data.
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await api.http.get<Status>('status'))
    } catch {
      // Surfaced, never swallowed.
      toast.error(t('Could not load the status'))
    } finally {
      setLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    // This scaffold is frontend-only — there is no /api/plugins/${id}/status until you add a backend
    // (re-run new-plugin without --frontend-only, or copy plugin-kit/example-hello/server/). Call load()
    // here once there is.
    void load
  }, [load])

  return (
    // Vienna inverts some surfaces, so branch on isVienna and add a class rather than hardcoding colours.
    <div className={\`plugin-page\${isVienna ? ' plugin-page-vienna' : ''}\`}>
      <h2 className="plugin-title">{t('${name}')}</h2>

      <p className="plugin-line">
        {t('Signed in as')}: <strong>{isAuthenticated ? user?.email : '—'}</strong>
      </p>

      {loading ? <p className="plugin-line">{t('Loading...')}</p> : null}
      {status ? <p className="plugin-line">{String(status.ok)}</p> : null}
    </div>
  )
}
`

  return `import { useCallback, useEffect, useState } from 'react'
import { toast, useAuth, usePluginApi, useT, useTheme } from '@caxperts/toolkit-plugin-sdk'

/** The host success envelope is { data: … } (see REQUIRED_DOCS/API_ERROR_HANDLING.md); unwrap it once. */
interface StatusResponse {
  data: { ok: boolean; email: string; schema: string | null }
}

export function ${component}() {
  const t = useT()
  const { user, isAuthenticated } = useAuth()
  const { isVienna } = useTheme()

  // The plugin's own API. \`api.http\` takes paths relative to /api/plugins/${id}/, which the host's route
  // convention forces on every plugin controller — so the prefix is never written by hand. A full
  // /api/… path still works, for calling other parts of the product.
  const api = usePluginApi()

  const [status, setStatus] = useState<StatusResponse['data'] | null>(null)
  // "Loading" and "empty" must not look the same, or a failure reads as no data.
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // -> GET /api/plugins/${id}/status, served by the backend's StatusController.
      const response = await api.http.get<StatusResponse>('status')
      setStatus(response.data)
    } catch {
      // Surfaced, never swallowed.
      toast.error(t('Could not load the status'))
    } finally {
      setLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    // Vienna inverts some surfaces, so branch on isVienna and add a class rather than hardcoding colours.
    <div className={\`plugin-page\${isVienna ? ' plugin-page-vienna' : ''}\`}>
      <h2 className="plugin-title">{t('${name}')}</h2>

      <p className="plugin-line">
        {t('Signed in as')}: <strong>{isAuthenticated ? user?.email : '—'}</strong>
      </p>

      {loading ? (
        <p className="plugin-line">{t('Loading...')}</p>
      ) : status ? (
        <p className="plugin-line">
          {t('Backend says')}: <strong>{status.ok ? 'OK' : '—'}</strong>
        </p>
      ) : null}
    </div>
  )
}
`
}

/**
 * The backend half, wired for a partner. Every file is the same shape as plugin-kit/example-hello/server/,
 * with the id, assembly, schema and class name substituted in — and the SDK referenced as the one
 * published package rather than by path into this repository.
 */
function backendFiles({ id, cls, assembly, schema }) {
  return {
    'nuget.config': `<?xml version="1.0" encoding="utf-8"?>
<!--
  Package sources for this plugin.

  A plugin's backend needs the host SDK package (CAXperts.Toolkit.Plugins.Abstractions) and,
  transitively, EF Core. Both are on nuget.org, so that is the only source. There is no nuget.config
  above a partner's plugin, so without this file the restore resolves whatever machine/user sources
  happen to be configured.
-->
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
  </packageSources>
</configuration>
`,

    'Directory.Build.props': `<Project>

  <!--
    Build settings for this plugin's backend. A plugin sits OUTSIDE the host's backend/ and inherits
    nothing from it, so every property a plugin needs is stated here once, keeping the .csproj to what is
    specific to the project. MSBuild walks UP from the project and stops at the first Directory.Build.props,
    so this file travels with the folder and is what makes it a working starting point.
  -->

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>

    <!-- The host SDK version. One package, so this is the only version there is to state.
         Match it (and the matching host) when you move to a newer host. -->
    <PluginSdkPackageVersion>${SDK_PACKAGE_VERSION}</PluginSdkPackageVersion>

    <!-- NU1900 is "could not REACH the vulnerability database", not "a vulnerability was found". The real
         findings are NU1901-NU1904 and stay errors; without this, an offline build fails on connectivity. -->
    <WarningsNotAsErrors>$(WarningsNotAsErrors);NU1900</WarningsNotAsErrors>

    <!-- Emits a *.deps.json next to the assembly so the host's AssemblyDependencyResolver can find the
         plugin's private dependencies. Copies of host-owned assemblies are inert (the host delegates
         those names back to its own load context). -->
    <EnableDynamicLoading>true</EnableDynamicLoading>
  </PropertyGroup>

</Project>
`,

    [`server/${assembly}.csproj`]: `<Project Sdk="Microsoft.NET.Sdk">

  <!--
    ASSEMBLY NAME: deliberately not Toolkit.*/System.*/Microsoft.*/Azure.*/Swashbuckle.* — PluginLoadContext
    prefix-matches those and delegates them to the host, and an assembly resolved BY NAME the host does not
    have fails to load. "${assembly}" is derived from the plugin id, which is your own namespace.
  -->

  <PropertyGroup>
    <AssemblyName>${assembly}</AssemblyName>
    <RootNamespace>${assembly}</RootNamespace>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>

  <ItemGroup>
    <!--
      The host SDK — ONE package. It carries the plugin contract plus the host's ToolkitDbContext and
      entities, so there is nothing else to reference and no versions to keep in step.

      ExcludeAssets="runtime;native" keeps the host's own assemblies OUT of your package: the host
      supplies them and their type identity must be the host's. Both words matter — "runtime" and
      "native" are separate NuGet asset classes, and excluding only the former leaves
      Microsoft.Data.SqlClient's native SNI binaries in a package bound for a Linux container.
      \`npm run pack\` warns if any slip in.
    -->
    <PackageReference Include="CAXperts.Toolkit.Plugins.Abstractions" Version="$(PluginSdkPackageVersion)" ExcludeAssets="runtime;native" />
  </ItemGroup>

  <!--
    No Microsoft.EntityFrameworkCore.Design and no IDesignTimeDbContextFactory: \`dotnet ef\` cannot work
    against a plugin library, and the migration below is hand-written, which is all Migrate() needs. See
    ${cls}DbContext.cs and REQUIRED_DOCS/PLUGINS.md.
  -->

</Project>
`,

    [`server/${cls}Plugin.cs`]: `using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Toolkit.Plugins.Abstractions;

namespace ${assembly};

/// <summary>
/// The one <see cref="IToolkitPlugin"/> in this assembly. The host finds it by reflection and requires a
/// public parameterless constructor.
/// </summary>
public sealed class ${cls}Plugin : IToolkitPlugin, IPluginMigrations
{
    /// <summary>Must equal plugin.json's id and the installed folder name.</summary>
    public string Id => "${id}";

    /// <summary>
    /// Applied at startup when <c>Plugins:AutoMigrate</c> is on; otherwise the host logs that this
    /// plugin's <c>migrations/*.sql</c> must be applied by a DBA.
    /// </summary>
    public IReadOnlyList<Type> DbContextTypes => [typeof(${cls}DbContext)];

    public void ConfigureServices(IServiceCollection services, IPluginContext context)
    {
        services.AddDbContext<${cls}DbContext>(o => o.UseSqlServer(
            context.DatabaseConnectionString,
            sql =>
            {
                // The Assembly overload, NOT MigrationsAssembly(string): the string form resolves through
                // Assembly.Load in the default load context, which cannot see an assembly the host loaded
                // from a stream — Migrate() would then find no migrations at all.
                sql.MigrationsAssembly(typeof(${cls}Plugin).Assembly);
                // History table inside the plugin's own schema, so an uninstall never leaves rows the host
                // cannot explain and the host's own migration history stays untouched.
                sql.MigrationsHistoryTable("__EFMigrationsHistory", context.DatabaseSchema);
                sql.CommandTimeout(30);
            }));

        // Registrations the plugin owns go here. Host services — ToolkitDbContext, ICurrentUser,
        // IConfiguration, ILogger<T>, IHttpClientFactory — need no registration and can simply be injected.
        services.AddSingleton(new ${cls}PluginInfo(
            Version: context.Manifest.Version,
            Schema: context.DatabaseSchema));
    }
}

/// <summary>What this plugin exposes to its own controllers: its version and its schema.</summary>
public sealed record ${cls}PluginInfo(string Version, string? Schema);
`,

    [`server/${cls}DbContext.cs`]: `using Microsoft.EntityFrameworkCore;
// DbContextAttribute lives here, not in the two obvious namespaces — without it [DbContext(typeof(…))]
// below binds to the DbContext CLASS and the plugin fails to build with CS0616.
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace ${assembly};

/// <summary>One item, owned by the user who created it.</summary>
/// <remarks>
/// <see cref="CreatedBySubject"/> is the read-path security boundary: every query filters on it, so two
/// users sharing this one table cannot see each other's rows. It comes from the authenticated principal
/// (the OIDC <c>sub</c> claim), never from the request body.
/// </remarks>
public sealed class Item
{
    public int Id { get; set; }
    public string Message { get; set; } = string.Empty;

    /// <summary>
    /// The OIDC <c>sub</c> claim. Deliberately NOT <c>ICurrentUser.Id</c>, which int.TryParses the subject
    /// and so returns 0 for every real (GUID-subject) user — keying ownership on it keys every row on 0.
    /// </summary>
    public string CreatedBySubject { get; set; } = string.Empty;

    /// <summary>Denormalised for display, so listing needs no join back to the host.</summary>
    public string CreatedByEmail { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; }
}

/// <summary>The plugin's own context, in the plugin's own <c>plg_*</c> schema.</summary>
public sealed class ${cls}DbContext(DbContextOptions<${cls}DbContext> options) : DbContext(options)
{
    /// <summary>Must match <c>plugin.json</c>'s <c>database.schema</c>.</summary>
    public const string Schema = "${schema}";

    public DbSet<Item> Items => Set<Item>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Item>(entity =>
        {
            entity.ToTable("Items", Schema);
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Message).HasMaxLength(400).IsRequired();
            // 64 rather than 36: a GUID subject fits in 36, but another identity provider's sub need not,
            // and this column is the security boundary — truncating it would merge owners.
            entity.Property(e => e.CreatedBySubject).HasMaxLength(64).IsRequired();
            entity.Property(e => e.CreatedByEmail).HasMaxLength(320).IsRequired();

            // Every read is "this user's newest rows", so the index carries the sort as well as the filter
            // and the query stays a seek no matter how large the table grows.
            entity.HasIndex(e => new { e.CreatedBySubject, e.Id })
                .IsDescending(false, true)
                .HasDatabaseName("IX_Items_CreatedBySubject_Id");
        });
    }
}

/// <summary>
/// Hand-written rather than scaffolded: applying migrations only needs <see cref="Migration"/> subclasses
/// carrying <c>[DbContext]</c> and <c>[Migration]</c> — a model snapshot is required by
/// <c>migrations add</c>, not by <c>Migrate()</c>. Keep <c>migrations/001_${schema}.sql</c> in step with
/// this class: the host applies THIS when <c>Plugins:AutoMigrate</c> is on; the SQL is what a DBA runs
/// when it is off.
/// </summary>
[DbContext(typeof(${cls}DbContext))]
[Migration("20240101000000_Initial")]
public sealed class Initial : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.EnsureSchema(name: ${cls}DbContext.Schema);

        migrationBuilder.CreateTable(
            name: "Items",
            schema: ${cls}DbContext.Schema,
            columns: table => new
            {
                Id = table.Column<int>(nullable: false).Annotation("SqlServer:Identity", "1, 1"),
                Message = table.Column<string>(maxLength: 400, nullable: false),
                CreatedBySubject = table.Column<string>(maxLength: 64, nullable: false),
                CreatedByEmail = table.Column<string>(maxLength: 320, nullable: false),
                CreatedAtUtc = table.Column<DateTime>(nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_Items", x => x.Id));

        migrationBuilder.CreateIndex(
            name: "IX_Items_CreatedBySubject_Id",
            schema: ${cls}DbContext.Schema,
            table: "Items",
            columns: ["CreatedBySubject", "Id"],
            descending: [false, true]);
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable(name: "Items", schema: ${cls}DbContext.Schema);
}
`,

    'server/Controllers/StatusController.cs': `using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Toolkit.Domain.Interfaces;

namespace ${assembly}.Controllers;

/// <summary>
/// No <c>[Authorize]</c> and no <c>api/…</c> prefix here: the host's route convention adds both, mapping
/// this controller to <c>api/plugins/${id}/status</c> with authorization required by default.
/// </summary>
[ApiController]
[Route("status")]
public sealed class StatusController(${cls}PluginInfo info) : ControllerBase
{
    /// <summary>Anonymous liveness probe — touches no database and needs no token.</summary>
    [HttpGet("ping")]
    [AllowAnonymous]
    public IActionResult Ping() => Ok(new { data = new { ok = true, version = info.Version } });

    /// <summary>
    /// Authorized by the convention's default: 401 without a token, 200 with one. This is what the
    /// scaffold's page calls on load.
    /// </summary>
    [HttpGet]
    public IActionResult Status([FromServices] ICurrentUser currentUser) =>
        Ok(new { data = new { ok = true, email = currentUser.Email, schema = info.Schema } });
}
`,

    'server/Controllers/ItemsController.cs': `using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Toolkit.Domain.Interfaces;
using Toolkit.Plugins.Abstractions;

namespace ${assembly}.Controllers;

/// <summary>Body of a create request. Only the message comes from the client — never the owner.</summary>
public sealed record CreateItemRequest(string? Message);

/// <summary>
/// The plugin's own table, in the plugin's own schema, through the plugin's own <see cref="${cls}DbContext"/>.
/// The rule it demonstrates: rows are owned by a user, and ownership comes from the authenticated
/// principal's OIDC subject — never from the request. Both the read and the delete filter on it, so two
/// users sharing one table cannot see or remove each other's rows.
/// </summary>
[ApiController]
[Route("items")]
public sealed class ItemsController(${cls}DbContext db, ICurrentUser currentUser) : PluginControllerBase
{
    // Reads are capped: returning "everything" is how a page that worked in testing takes the server down
    // at a customer whose table grew with usage.
    private const int MaxRows = 50;
    private const int MaxMessageLength = 400;

    /// <summary>This user's newest items. Matches IX_Items_CreatedBySubject_Id, so it stays an index seek.</summary>
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!TryGetSubject(out var subject)) return NoSubject();

        var items = await db.Items
            .Where(i => i.CreatedBySubject == subject)
            .OrderByDescending(i => i.Id)
            .Take(MaxRows)
            .Select(i => new { i.Id, i.Message, i.CreatedByEmail, i.CreatedAtUtc })
            .ToListAsync(cancellationToken);

        return Ok(new { data = new { items } });
    }

    /// <summary>Adds an item owned by the calling user.</summary>
    [HttpPost]
    public async Task<IActionResult> Create(
        [FromBody] CreateItemRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetSubject(out var subject)) return NoSubject();

        var message = request.Message?.Trim();

        if (string.IsNullOrEmpty(message))
            return BadRequest(new { error = "An item needs a message." });

        // Checked before the insert: a truncation error surfaces as an opaque 500, and the column is
        // nvarchar(400).
        if (message.Length > MaxMessageLength)
            return BadRequest(new { error = $"An item may be at most {MaxMessageLength} characters." });

        var item = new Item
        {
            Message = message,
            CreatedBySubject = subject,
            CreatedByEmail = currentUser.Email,
            CreatedAtUtc = DateTime.UtcNow,
        };

        db.Items.Add(item);
        await db.SaveChangesAsync(cancellationToken);

        return Ok(new { data = new { item.Id, item.Message, item.CreatedAtUtc } });
    }

    /// <summary>Deletes one of the calling user's own items.</summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        if (!TryGetSubject(out var subject)) return NoSubject();

        // The owner is part of the WHERE clause, not checked afterwards: someone else's id simply matches
        // nothing. The 404 is deliberate — a 403 would confirm the row exists.
        var removed = await db.Items
            .Where(i => i.Id == id && i.CreatedBySubject == subject)
            .ExecuteDeleteAsync(cancellationToken);

        return removed == 0
            ? NotFound(new { error = "No such item." })
            : Ok(new { data = new { id } });
    }
}
`,

    [`migrations/001_${schema}.sql`]: migrationSql(schema),
  }
}

/**
 * The AutoMigrate=false path: an idempotent script a DBA runs by hand, plus the __EFMigrationsHistory
 * rows so a later AutoMigrate=true run does not try to recreate what exists. It only ever touches the
 * plugin's own schema — pack-plugin --check enforces that. Keep it in step with the migration in the
 * DbContext.
 */
function migrationSql(schema) {
  return `-- Idempotent equivalent of this plugin's EF migration, for customers where the application's SQL login
-- does not hold CREATE SCHEMA / CREATE TABLE and a DBA applies schema changes by hand
-- (Plugins:AutoMigrate=false). It also inserts the __EFMigrationsHistory rows, or a later AutoMigrate=true
-- run would try to create tables that already exist. Keep it in step with the migration in the DbContext.

IF OBJECT_ID(N'[${schema}].[__EFMigrationsHistory]') IS NULL
BEGIN
    IF SCHEMA_ID(N'${schema}') IS NULL EXEC(N'CREATE SCHEMA [${schema}];');
    CREATE TABLE [${schema}].[__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [${schema}].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20240101000000_Initial'
)
BEGIN
    IF SCHEMA_ID(N'${schema}') IS NULL EXEC(N'CREATE SCHEMA [${schema}];');
END;

IF NOT EXISTS (
    SELECT * FROM [${schema}].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20240101000000_Initial'
)
BEGIN
    CREATE TABLE [${schema}].[Items] (
        [Id] int NOT NULL IDENTITY,
        [Message] nvarchar(400) NOT NULL,
        [CreatedBySubject] nvarchar(64) NOT NULL,
        [CreatedByEmail] nvarchar(320) NOT NULL,
        [CreatedAtUtc] datetime2 NOT NULL,
        CONSTRAINT [PK_Items] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [${schema}].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20240101000000_Initial'
)
BEGIN
    CREATE INDEX [IX_Items_CreatedBySubject_Id] ON [${schema}].[Items] ([CreatedBySubject], [Id] DESC);
END;

IF NOT EXISTS (
    SELECT * FROM [${schema}].[__EFMigrationsHistory]
    WHERE [MigrationId] = N'20240101000000_Initial'
)
BEGIN
    INSERT INTO [${schema}].[__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20240101000000_Initial', N'10.0.0');
END;

COMMIT;
GO
`
}

function readme({ id, name, backend, assembly, schema }) {
  const commands = backend
    ? `\`\`\`bash
npm install
npm run validate     # manifest/menu/translations/migration — no build needed, ~1s
npm run typecheck    # tsc --noEmit against the SDK's types
npm run build:all    # frontend -> dist/, then dotnet publish server -> backend/
npm run stage        # build both, then expand into .plugins-dev/${id}/ for local dev
npm run pack         # build both, then package -> ${id}-1.0.0.zip
\`\`\`

> The backend build restores \`CAXperts.Toolkit.Plugins.Abstractions\` from nuget.org (the only source
> in \`nuget.config\`); \`npm run build:all\` fails at restore if \`PluginSdkPackageVersion\` names a
> version that is not published there.`
    : `\`\`\`bash
npm install
npm run validate     # manifest/menu/translations — no build needed, ~1s
npm run typecheck    # tsc --noEmit against the SDK's types
npm run build        # -> dist/index.js + dist/style.css
npm run stage        # build, then expand into .plugins-dev/${id}/ for local dev
npm run pack         # build, then package -> ${id}-1.0.0.zip
\`\`\``

  const backendSection = backend
    ? `## The backend

\`server/\` is a .NET class library the host loads in-process. \`npm run build:server\` publishes it into
\`backend/\`, which is what \`plugin.json\`'s \`entryAssembly\` (\`backend/${assembly}.dll\`) points at.

- **${assembly}Plugin.cs** — the \`IToolkitPlugin\`, registering the \`DbContext\` against schema \`${schema}\`.
- **${assembly}DbContext.cs** — one table plus a hand-written EF migration.
- **Controllers/StatusController.cs** — a \`ping\` (anonymous) and a \`status\` (authorized) endpoint; the
  page calls the latter on load.
- **Controllers/ItemsController.cs** — the pattern that matters: rows owned by the caller's OIDC
  \`subject\`, filtered in the \`WHERE\` clause of every read and delete. Never key ownership on
  \`ICurrentUser.Id\` — it is 0 for every real user.
- **migrations/001_${schema}.sql** — the DBA script for \`Plugins:AutoMigrate=false\`.

The \`.csproj\` carries ONE host reference, \`CAXperts.Toolkit.Plugins.Abstractions\`, pinned to
\`PluginSdkPackageVersion\` in \`Directory.Build.props\`. That single package brings \`Toolkit.Data\`
(\`ToolkitDbContext\`) and \`Toolkit.Domain\` (the entities) with it, so there is no second version to keep
in step. See https://github.com/caxperts/Toolkit.Plugins.Examples for the type/namespace/package map and the full contract.

**Version this plugin, never the host assemblies it binds.** A plugin binds the exact
\`AssemblyVersion\` it compiled against, and the host assemblies inside the SDK package carry the
default \`1.0.0.0\` that every host image also ships. Do not pass a global \`-p:Version=…\` to the
\`dotnet\` build: an MSBuild global property reaches every project in the build, and it will restamp
those assemblies if the build ever sees them. The plugin then binds an identity no released host can
supply and is rejected as \`Incompatible\` at startup. This plugin's own version lives in
\`plugin.json\`, which is what \`npm run pack\` reads.`
    : `## Adding a backend

This scaffold is frontend-only. Re-run \`new-plugin\` without \`--frontend-only\` for a full backend, or copy
\`plugin-kit/example-hello/server/\`. Either way the backend's assembly must NOT be prefixed \`Toolkit.\`,
\`System.\`, \`Microsoft.\` or another host-owned prefix, its ownership must key on the OIDC \`subject\` (never
\`ICurrentUser.Id\`, which is 0 for every real user), and it needs a \`plg_\` schema and a migration.`

  return `# ${name}

A Toolkit plugin. Contract, trust model and packaging rules: https://github.com/caxperts/Toolkit.Plugins.Examples.

${commands}

Run \`validate\` and \`typecheck\` before building: both are fast and need no build output, so a manifest
typo or a type error costs a second rather than a full build.

## The id

\`${id}\` appears in \`plugin.json\`, in \`definePlugin({ id })\`${
    backend ? ", in the backend's `IToolkitPlugin.Id`," : ','
  } and as the installed folder
name. The host cross-checks them and refuses to load a plugin whose ids disagree. Nothing else needs it —
\`vite.config.ts\` reads it from the manifest, and \`usePluginApi()\` derives the \`/api/plugins/${id}/\`
prefix.

${backendSection}
`
}

main()
