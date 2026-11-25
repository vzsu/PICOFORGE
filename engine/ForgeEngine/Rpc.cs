// ForgeEngine/Rpc.cs — ndjson JSON-RPC framing over stdio (docs/04 §5)
// One JSON object per line. Requests: {id, method, params}. Replies: {id, result} | {id, error:{code,message}}.
// Notifications: {method, payload}.

using System.Text.Json;
using System.Text.Json.Nodes;

namespace ForgeEngine;

internal sealed class RpcRequest
{
    /// <summary>Request id, echoed verbatim (string or number).</summary>
    public JsonNode? Id { get; init; }
    public required string Method { get; init; }
    public JsonObject Params { get; init; } = [];

    public static RpcRequest? TryParse(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return null;
        try
        {
            if (JsonNode.Parse(line) is not JsonObject node) return null;
            if (node["method"] is not JsonValue mv || !mv.TryGetValue<string>(out var method)) return null;
            return new RpcRequest
            {
                Id = node["id"]?.DeepClone(),
                Method = method,
                Params = node["params"] as JsonObject is { } p ? (JsonObject)p.DeepClone() : [],
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>Typed RPC failure; becomes an `{error:{code,message}}` frame.</summary>
[System.Diagnostics.CodeAnalysis.SuppressMessage("Design", "CA1032:Implement standard exception constructors",
    Justification = "Internal typed failure; an error code is always required.")]
internal sealed class RpcException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

internal static class RpcWriter
{
    private static readonly Lock Gate = new();
    private static readonly JsonSerializerOptions Opts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static void WriteResult(JsonNode? id, object result) => WriteFrame(JsonSerializer.Serialize(new { id, result }, Opts));

    public static void WriteError(JsonNode? id, string code, string message)
        => WriteFrame(JsonSerializer.Serialize(new { id, error = new { code, message } }, Opts));

    public static void WriteNotification(string method, object payload)
        => WriteFrame(JsonSerializer.Serialize(new { method, payload }, Opts));

    private static void WriteFrame(string frame)
    {
        lock (Gate)
        {
            Console.Out.Write(frame);
            Console.Out.Write('\n');
            Console.Out.Flush();
        }
    }
}
