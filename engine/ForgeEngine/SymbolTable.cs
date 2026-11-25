// ForgeEngine/SymbolTable.cs — Loads picogk_api.json (DumpApi output) and provides fuzzy matching
// LLM_HARNESS §4.3 — unknown symbols get "did you mean?" suggestions

using System.Security.Cryptography;
using System.Text.Json;

namespace ForgeEngine;

internal sealed record ApiSymbol(string TypeName, string MemberName, string Kind, string Sig);

internal sealed class SymbolTable
{
    private readonly IReadOnlyList<ApiSymbol> _symbols;

    public string Hash { get; }
    public string PicoGKVersion { get; }

    private SymbolTable(IReadOnlyList<ApiSymbol> symbols, string hash, string picogkVersion)
    {
        _symbols = symbols;
        Hash = hash;
        PicoGKVersion = picogkVersion;
    }

    public static SymbolTable Load(string jsonPath)
    {
        if (!File.Exists(jsonPath)) return new SymbolTable([], "empty", "unknown");

        var bytes = File.ReadAllBytes(jsonPath);
        var hash = Convert.ToHexStringLower(SHA256.HashData(bytes));
        using var doc = JsonDocument.Parse(bytes);
        var symbols = new List<ApiSymbol>();
        var version = doc.RootElement.TryGetProperty("picogkVersion", out var v) ? v.GetString() ?? "unknown" : "unknown";

        if (doc.RootElement.TryGetProperty("types", out var types))
        {
            foreach (var type in types.EnumerateArray())
            {
                var typeName = type.GetProperty("name").GetString() ?? "";
                if (!type.TryGetProperty("members", out var members)) continue;
                foreach (var member in members.EnumerateArray())
                {
                    symbols.Add(new ApiSymbol(
                        typeName,
                        member.GetProperty("name").GetString() ?? "",
                        member.GetProperty("kind").GetString() ?? "",
                        member.GetProperty("sig").GetString() ?? ""));
                }
            }
        }
        return new SymbolTable(symbols, hash, version);
    }

    public int Count => _symbols.Count;

    /// <summary>Fuzzy match: top-3 suggestions for an unknown identifier.</summary>
    public IReadOnlyList<string> Suggest(string unknown)
    {
        ArgumentNullException.ThrowIfNull(unknown);
        var u = unknown.ToUpperInvariant();
        return _symbols
            .Select(s => (sym: s, dist: Levenshtein(u, s.MemberName.ToUpperInvariant())))
            .Where(x => x.dist <= 4)
            .OrderBy(x => x.dist)
            .Select(x => $"{x.sym.TypeName}.{x.sym.MemberName}")
            .Distinct(StringComparer.Ordinal)
            .Take(3)
            .ToArray();
    }

    public bool IsKnown(string memberName)
        => _symbols.Any(s => string.Equals(s.MemberName, memberName, StringComparison.Ordinal));

    private static int Levenshtein(string a, string b)
    {
        var prev = new int[b.Length + 1];
        var cur = new int[b.Length + 1];
        for (int j = 0; j <= b.Length; j++) prev[j] = j;
        for (int i = 1; i <= a.Length; i++)
        {
            cur[0] = i;
            for (int j = 1; j <= b.Length; j++)
                cur[j] = Math.Min(Math.Min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
            (prev, cur) = (cur, prev);
        }
        return prev[b.Length];
    }
}
