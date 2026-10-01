using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Example.Hello;

/// <summary>
/// One greeting, owned by the user who wrote it.
/// </summary>
/// <remarks>
/// <see cref="CreatedBySubject"/> is what makes the read path safe: every query filters on it, so a
/// user cannot read or delete another user's rows even though they share one table. It comes from the
/// authenticated principal, never from the request body.
/// </remarks>
public sealed class Greeting
{
    public int Id { get; set; }
    public string Message { get; set; } = string.Empty;

    /// <summary>
    /// The OIDC <c>sub</c> claim — a GUID from Keycloak — and the only stable per-user identity a
    /// plugin can rely on.
    /// </summary>
    /// <remarks>
    /// Deliberately NOT <c>ICurrentUser.Id</c>. That property does <c>int.TryParse</c> on the subject
    /// claim, and a Keycloak subject is a GUID, so it returns <b>0 for every real user</b>. Keying
    /// ownership on it means keying every row on 0 — and a guard that rejects 0 rejects everyone,
    /// which is exactly the 401 this column replaced. Email is not used either: it is
    /// scope-dependent and can be reassigned, whereas <c>sub</c> is guaranteed and immutable.
    /// </remarks>
    public string CreatedBySubject { get; set; } = string.Empty;

    /// <summary>Denormalised for display, so listing greetings needs no join back to the host.</summary>
    public string CreatedByEmail { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; }
}

/// <summary>
/// The plugin's own context, in the plugin's own <c>plg_*</c> schema.
/// </summary>
/// <remarks>
/// Plugin entities are deliberately NOT hooked into <c>ToolkitDbContext.OnModelCreating</c>: that
/// would make the host's model depend on which plugins happen to be installed, put plugin
/// migrations into the host's history table, and let a plugin bug in <c>OnModelCreating</c> break
/// every request in the product.
/// <para>
/// To join these tables against host tables in SQL rather than in memory, map the host table
/// read-only into this context with
/// <c>ToTable(name, schema, t =&gt; t.ExcludeFromMigrations())</c>.
/// </para>
/// </remarks>
public sealed class HelloDbContext(DbContextOptions<HelloDbContext> options) : DbContext(options)
{
    /// <summary>Must match <c>plugin.json</c>'s <c>database.schema</c>.</summary>
    public const string Schema = "plg_hello";

    public DbSet<Greeting> Greetings => Set<Greeting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Greeting>(entity =>
        {
            entity.ToTable("Greetings", Schema);
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Message).HasMaxLength(400).IsRequired();
            // 64 rather than 36: a GUID subject fits in 36, but another identity provider's `sub` need
            // not be one, and this column is the security boundary — truncating it would merge owners.
            entity.Property(e => e.CreatedBySubject).HasMaxLength(64).IsRequired();
            entity.Property(e => e.CreatedByEmail).HasMaxLength(320).IsRequired();

            // Every read is "this user's newest rows", so the index carries the sort as well as the
            // filter and the query stays a seek no matter how large the table gets. A demo table
            // does not need this; a plugin whose table grows with usage very much does, and the
            // example is what partners copy.
            entity.HasIndex(e => new { e.CreatedBySubject, e.Id })
                .IsDescending(false, true)
                .HasDatabaseName("IX_Greetings_CreatedBySubject_Id");
        });
    }
}

/// <summary>
/// Hand-written rather than scaffolded, because applying migrations only needs
/// <see cref="Migration"/> subclasses carrying <c>[DbContext]</c> and <c>[Migration]</c> — a model
/// snapshot is required for <c>dotnet ef migrations add</c>, not for <c>Migrate()</c>.
/// </summary>
/// <remarks>
/// Keep <c>migrations/001_plg_hello.sql</c> in step with this class. The host applies THIS when
/// <c>Plugins:AutoMigrate</c> is on; the SQL script is what a DBA runs when it is off, which is the
/// normal arrangement at customers who do not let an application change its own schema.
/// </remarks>
[DbContext(typeof(HelloDbContext))]
[Migration("20260803120000_InitialHello")]
public sealed class InitialHello : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.EnsureSchema(name: HelloDbContext.Schema);

        migrationBuilder.CreateTable(
            name: "Greetings",
            schema: HelloDbContext.Schema,
            columns: table => new
            {
                Id = table.Column<int>(nullable: false).Annotation("SqlServer:Identity", "1, 1"),
                Message = table.Column<string>(maxLength: 400, nullable: false),
                CreatedBySubject = table.Column<string>(maxLength: 64, nullable: false),
                CreatedByEmail = table.Column<string>(maxLength: 320, nullable: false),
                CreatedAtUtc = table.Column<DateTime>(nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_Greetings", x => x.Id));

        migrationBuilder.CreateIndex(
            name: "IX_Greetings_CreatedBySubject_Id",
            schema: HelloDbContext.Schema,
            table: "Greetings",
            columns: ["CreatedBySubject", "Id"],
            descending: [false, true]);
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable(name: "Greetings", schema: HelloDbContext.Schema);
}
