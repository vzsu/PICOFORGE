// ForgeEngine/Program.cs — Engine host entry point
// stdin ndjson JSON-RPC loop; supervises sandbox children (docs/04 §2, §5).
// Long methods run concurrently so engine.ping answers while a build runs (ENG-ISO-01).

using ForgeEngine;

var opts = EngineOptions.Discover();
using var host = new EngineHost(opts);
await Console.Error.WriteLineAsync($"[engine] forge-engine {EngineHost.Version} ready (sandbox={opts.SandboxBin}, symbolTableHash={host.SymbolTableHash})").ConfigureAwait(false);

var inflight = new List<Task>();
while (await Console.In.ReadLineAsync().ConfigureAwait(false) is { } line)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    var req = RpcRequest.TryParse(line);
    if (req is null)
    {
        RpcWriter.WriteError(null, "PARSE_ERROR", "Invalid JSON-RPC frame");
        continue;
    }
    if (EngineHost.IsLong(req.Method))
    {
        inflight.RemoveAll(t => t.IsCompleted);
        inflight.Add(Task.Run(() => host.HandleAsync(req)));
    }
    else
    {
        await host.HandleAsync(req).ConfigureAwait(false);
    }
}

// stdin closed: the supervisor is gone. Finish in-flight replies briefly, then kill children (via Dispose).
await Task.WhenAny(Task.WhenAll(inflight), Task.Delay(TimeSpan.FromSeconds(2))).ConfigureAwait(false);
return 0;
