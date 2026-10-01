using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Toolkit.Plugins.Abstractions;

namespace Example.Hello;

/// <summary>
/// The one <see cref="IToolkitPlugin"/> implementation in this assembly. The host finds it by
/// reflection and requires a public parameterless constructor.
/// </summary>
public sealed class HelloPlugin : IToolkitPlugin, IPluginMigrations, IPluginStartup
{
    /// <summary>Must equal plugin.json's id and the installed folder name.</summary>
    public string Id => "hello";

    /// <summary>
    /// Migrated at startup when <c>Plugins:AutoMigrate</c> is on; otherwise the host logs that
    /// this plugin's <c>migrations/*.sql</c> has to be applied by a DBA.
    /// </summary>
    public IReadOnlyList<Type> DbContextTypes => [typeof(HelloDbContext)];

    /// <summary>
    /// One-off initialisation, run once after the container is built and before the first request.
    /// </summary>
    /// <remarks>
    /// Note that the cancellation token is passed all the way through to the I/O call. It is not
    /// decoration: this runs inside <c>Plugins:StartupTimeoutSeconds</c>, and startup blocks the
    /// container healthcheck — a plugin that ignores the token and blocks here produces a restart
    /// loop that never heals. Honouring it is what lets the host give up and carry on without it.
    /// </remarks>
    public async Task StartAsync(IServiceProvider scopedServices, CancellationToken cancellationToken)
    {
        var info = scopedServices.GetRequiredService<HelloPluginInfo>();

        // DataDirectory is the writable, per-plugin folder the host created and that survives an
        // update — unlike PluginDirectory, which is replaced wholesale.
        var marker = Path.Combine(info.DataDirectory, "last-start.txt");
        await File.WriteAllTextAsync(marker, DateTime.UtcNow.ToString("O"), cancellationToken);
    }

    public void ConfigureServices(IServiceCollection services, IPluginContext context)
    {
        services.AddDbContext<HelloDbContext>(o => o.UseSqlServer(
            context.DatabaseConnectionString,
            sql =>
            {
                // The Assembly overload, NOT MigrationsAssembly(string): the string form resolves
                // through Assembly.Load in the DEFAULT load context, which cannot see an assembly
                // the host loaded from a stream — Migrate() would find no migrations at all.
                sql.MigrationsAssembly(typeof(HelloPlugin).Assembly);

                // History table inside the plugin's own schema, so an uninstall never leaves rows
                // the host cannot explain, and the host's own migration history stays untouched.
                sql.MigrationsHistoryTable("__EFMigrationsHistory", context.DatabaseSchema);

                sql.CommandTimeout(30);
            }));

        // Registrations a plugin owns go here. The host's own services — ToolkitDbContext,
        // ICurrentUser, IBlobStorageService, IEmailService, IConfiguration, ILogger<T>,
        // IHttpClientFactory — need no registration and can simply be injected.
        services.AddSingleton(new HelloPluginInfo(
            Version: context.Manifest.Version,
            Schema: context.DatabaseSchema,
            DataDirectory: context.DataDirectory,
            Greeting: context.Settings["Greeting"] ?? "Hello from the example plugin"));
    }
}

/// <summary>
/// Demonstrates the two things a plugin usually wants from its context: its own configuration
/// section (<c>Plugins:Settings:hello</c>) and its writable data directory.
/// </summary>
public sealed record HelloPluginInfo(string Version, string? Schema, string DataDirectory, string Greeting);
