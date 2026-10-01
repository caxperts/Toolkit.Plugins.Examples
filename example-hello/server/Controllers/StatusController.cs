using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Toolkit.Domain.Interfaces;
using Toolkit.Plugins.Abstractions;

namespace Example.Hello.Controllers;

/// <summary>One event of the demo stream. A named type rather than an anonymous one, so the JSON the
/// browser receives is declared in one place.</summary>
public sealed record TickEvent(int Tick);

/// <summary>
/// Note what is NOT here: no <c>[Authorize]</c> and no <c>api/…</c> prefix. The host's route
/// convention adds both, mapping this controller to <c>api/plugins/hello/status</c> with
/// authorization required by default. A rooted template (<c>/status</c> or <c>~/status</c>) would
/// disqualify the whole plugin, because it cannot be combined with that prefix.
/// </summary>
/// <remarks>
/// Split from <see cref="GreetingsController"/> to show that a plugin may ship as many controllers
/// as it likes — the convention applies to every one of them.
/// </remarks>
[ApiController]
[Route("status")]
public sealed class StatusController : ControllerBase
{
    private readonly HelloPluginInfo _info;

    public StatusController(HelloPluginInfo info) => _info = info;

    /// <summary>
    /// Deliberately anonymous so the host's loader tests can prove a stream-loaded assembly really
    /// routes without needing Keycloak — and it touches no database, so those tests need no SQL
    /// Server either. Opting out of the default authorization is an explicit, visible decision.
    /// </summary>
    [HttpGet("ping")]
    [AllowAnonymous]
    public IActionResult Ping() => Ok(new { data = new { status = "OK", version = _info.Version } });

    /// <summary>
    /// No attribute, so the convention's default <c>[Authorize]</c> applies: 401 without a token,
    /// 200 with one. Also shows the plugin reading its own configuration section
    /// (<c>Plugins:Settings:hello</c>) and the host's <c>ICurrentUser</c>.
    /// </summary>
    [HttpGet("me")]
    public IActionResult Me([FromServices] ICurrentUser currentUser) =>
        Ok(new
        {
            data = new
            {
                greeting = _info.Greeting,
                email = currentUser.Email,
                groups = currentUser.Groups,
                schema = _info.Schema,
            },
        });

    /// <summary>
    /// Pushing to the browser: a plugin has controllers and no hub to map, so Server-Sent Events are
    /// the way. Consume it with <c>new EventSource(api.url('status/events'))</c> — no auth work
    /// needed, because a same-origin request carries the host's access-token cookie.
    /// <para>
    /// <c>api.url</c>, not <c>api.path</c>: <c>EventSource</c> takes a raw browser URL, so it needs
    /// the deployment's path prefix that the host's HTTP client would otherwise add. The two are
    /// identical unless the deployment serves several instances under subpaths — see
    /// REQUIRED_DOCS/PLUGINS.md, "Path-based multi-tenancy".
    /// </para>
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="PluginSse"/> is used rather than writing to <c>Response.Body</c>, and that is not
    /// tidiness: it emits the opening frame that stops a frontend registering from
    /// <c>EventSource.onopen</c> from deadlocking against its own stream, and the keep-alive that stops
    /// a reverse proxy closing the connection while the stream is idle. Both failures are silent and
    /// neither is guessable from the symptom.
    /// </para>
    /// <para>
    /// The static helper is used here because this controller deliberately derives from
    /// <c>ControllerBase</c> to show that no base class is required; a controller deriving from
    /// <c>PluginControllerBase</c> calls the inherited <c>ServerSentEvents(…)</c> instead.
    /// </para>
    /// <para>
    /// Anonymous for the same reason as <see cref="Ping"/>: the host's pipeline tests exercise this
    /// without a Keycloak token. A real stream would keep the convention's default authorization.
    /// </para>
    /// </remarks>
    [HttpGet("events")]
    [AllowAnonymous]
    public IActionResult Events(CancellationToken ct) =>
        PluginSse.ServerSentEvents(Ticks(ct), eventType: "tick");

    /// <summary>
    /// A finite source, so the demo stream ends by itself. A real one is usually a
    /// <c>ChannelReader.ReadAllAsync(ct)</c> that only ends when the client disconnects.
    /// </summary>
    private static async IAsyncEnumerable<TickEvent> Ticks([EnumeratorCancellation] CancellationToken ct)
    {
        for (var i = 1; i <= 3; i++)
        {
            await Task.Delay(TimeSpan.FromMilliseconds(50), ct);
            yield return new TickEvent(i);
        }
    }
}
