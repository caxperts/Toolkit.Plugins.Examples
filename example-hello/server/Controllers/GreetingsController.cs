using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Toolkit.Domain.Interfaces;
// ToolkitDbContext. The namespace is Toolkit.Infrastructure.* but the assembly is Toolkit.Data, which
// ships inside CAXperts.Toolkit.Plugins.Abstractions — see the type/namespace/assembly table in
// REQUIRED_DOCS/PLUGINS.md. It does NOT come from Toolkit.Infrastructure, which a partner cannot
// restore.
using Toolkit.Infrastructure.Data;
using Toolkit.Plugins.Abstractions;

namespace Example.Hello.Controllers;

/// <summary>Body of a create request. Only the message comes from the client — never the owner.</summary>
public sealed record CreateGreetingRequest(string? Message);

/// <summary>
/// The plugin's own table, in the plugin's own schema, through the plugin's own
/// <see cref="HelloDbContext"/>. Every action here relies on the convention's default
/// <c>[Authorize]</c>; none opts out.
/// </summary>
/// <remarks>
/// The rule this controller demonstrates: rows are owned by a user, and ownership comes from the
/// authenticated principal's OIDC subject — never from the request. Both the read and the delete filter
/// on it, so two users sharing one table cannot see or remove each other's rows.
/// </remarks>
[ApiController]
[Route("greetings")]
public sealed class GreetingsController : PluginControllerBase
{
    /// <summary>
    /// Reads are capped rather than unbounded. A demo table never needs it; a plugin table that
    /// grows with usage does, and returning "everything" is how a page that worked in testing takes
    /// the server down at a customer.
    /// </summary>
    private const int MaxRows = 50;

    private const int MaxMessageLength = 400;

    private readonly HelloDbContext _db;
    private readonly ICurrentUser _currentUser;

    public GreetingsController(HelloDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    /*
     * Row ownership comes from PluginControllerBase.TryGetSubject — the OIDC `sub` claim — and that is
     * the whole point of this controller.
     *
     * NOT ICurrentUser.Id. That is an `int` produced by `int.TryParse` over the subject claim, and a
     * Keycloak subject is a GUID, so it returns 0 for every real user. An earlier version of this
     * controller required a non-zero id, which meant every authenticated request was answered 401:
     * authentication had already succeeded and the controller threw the request away. ICurrentUser is
     * still the right way to read Email, Name and Groups — only its Id is unusable.
     *
     * The eight lines that read the claim used to live here, in every plugin, and they are what decides
     * who owns a row. They are in the SDK now (see PluginPrincipal for the claim-name detail and why an
     * unauthenticated principal yields no subject) so that a plugin does not reinvent a security check
     * from a warning in the documentation.
     *
     * Still a guard, not a formality: an unidentifiable caller is an error, never user zero and never an
     * empty owner that every other unidentifiable caller would also match.
     */

    /// <summary>This user's newest greetings, plus one host-model read to show it is available.</summary>
    /// <remarks>
    /// Note that this holds two SQL connections for the duration of the request: the plugin's and the
    /// host's. Never open a plugin context inside a loop over host rows — see the scale rules in
    /// REQUIRED_DOCS/PLUGINS.md.
    /// </remarks>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromServices] ToolkitDbContext host,
        CancellationToken cancellationToken)
    {
        if (!TryGetSubject(out var subject)) return NoSubject();

        // Matches IX_Greetings_CreatedBySubject_Id, so this stays an index seek as the table grows.
        var greetings = await _db.Greetings
            .Where(g => g.CreatedBySubject == subject)
            .OrderByDescending(g => g.Id)
            .Take(MaxRows)
            .Select(g => new { g.Id, g.Message, g.CreatedByEmail, g.CreatedAtUtc })
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            data = new
            {
                greetings,
                // Proves host model access from inside a plugin: same model, same database.
                hostPageCount = await host.PageAccess.CountAsync(cancellationToken),
            },
        });
    }

    /// <summary>Adds a greeting owned by the calling user.</summary>
    [HttpPost]
    public async Task<IActionResult> Create(
        [FromBody] CreateGreetingRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetSubject(out var subject)) return NoSubject();

        var message = request.Message?.Trim();

        if (string.IsNullOrEmpty(message))
            return BadRequest(new { error = "A greeting needs a message." });

        // Checked before the insert rather than left to SQL: a truncation error surfaces as an
        // opaque 500, and the column is nvarchar(400).
        if (message.Length > MaxMessageLength)
            return BadRequest(new { error = $"A greeting may be at most {MaxMessageLength} characters." });

        var greeting = new Greeting
        {
            Message = message,
            CreatedBySubject = subject,
            CreatedByEmail = _currentUser.Email,
            CreatedAtUtc = DateTime.UtcNow,
        };

        _db.Greetings.Add(greeting);
        await _db.SaveChangesAsync(cancellationToken);

        return Ok(new { data = new { greeting.Id, greeting.Message, greeting.CreatedAtUtc } });
    }

    /// <summary>Deletes one of the calling user's own greetings.</summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        if (!TryGetSubject(out var subject)) return NoSubject();

        // The owner is part of the WHERE clause, not checked afterwards: someone else's id simply
        // matches nothing. The 404 is deliberate — a 403 would confirm that the row exists.
        var removed = await _db.Greetings
            .Where(g => g.Id == id && g.CreatedBySubject == subject)
            .ExecuteDeleteAsync(cancellationToken);

        return removed == 0
            ? NotFound(new { error = "No such greeting." })
            : Ok(new { data = new { id } });
    }
}
