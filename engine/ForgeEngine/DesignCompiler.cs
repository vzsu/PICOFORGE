// ForgeEngine/DesignCompiler.cs — contract check → Roslyn parse → banned-API analyzer → emit, with an LRU cache
// docs/04 §5 (engine.compile), §8 (analyzer before compile), docs/05 §5 (code contract)
// The host never loads or runs the emitted assembly; only the sandbox child does.

using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace ForgeEngine;

internal sealed record ForgeDiagnostic(string Id, string Severity, int Line, int Col, string Message);

internal sealed record CompileResult(
    bool Ok,
    string CodeId,
    bool DllCached,
    IReadOnlyList<ForgeDiagnostic> Diagnostics,
    ReadOnlyMemory<byte> Dll = default);

internal sealed partial class DesignCompiler
{
    private const int MaxCacheEntries = 32;
    private readonly Dictionary<string, ReadOnlyMemory<byte>> _cache = new(StringComparer.Ordinal);
    private readonly Queue<string> _cacheOrder = new();
    private readonly Lock _cacheLock = new();
    private readonly IReadOnlyList<MetadataReference> _references;

    // Whitelist of using directives (docs/05 §5 code contract).
    internal static readonly HashSet<string> AllowedUsings = new(StringComparer.Ordinal)
    {
        "System", "System.Numerics", "System.Collections.Generic", "System.Linq", "PicoGK", "PicoForge.Kit",
    };

    /// <param name="sandboxDir">Folder holding PicoGK.dll and forge-sandbox.dll (referenced as metadata only).</param>
    public DesignCompiler(string sandboxDir)
    {
        var fxDir = Path.GetDirectoryName(typeof(object).Assembly.Location)!;
        var tpa = (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Where(p => string.Equals(Path.GetDirectoryName(p), fxDir, StringComparison.OrdinalIgnoreCase));
        var refs = tpa.Select(p => (MetadataReference)MetadataReference.CreateFromFile(p)).ToList();
        foreach (var dll in new[] { "PicoGK.dll", "forge-sandbox.dll" })
        {
            var p = Path.Combine(sandboxDir, dll);
            if (File.Exists(p)) refs.Add(MetadataReference.CreateFromFile(p));
            else Console.Error.WriteLine($"[engine] warning: {p} missing; designs will not compile");
        }
        _references = refs;
    }

    /// <summary>Compile a trivial design once so the first real compile does not pay Roslyn JIT cost.</summary>
    public void WarmUp() => Compile(
        "using PicoGK; using PicoForge.Kit;\npublic static class Design { public static Voxels voxBuild(Ctx ctx) => new Voxels(); }",
        "warmup", useCache: false);

    public CompileResult Compile(string code, string? requestedCodeId = null, bool useCache = true)
    {
        ArgumentNullException.ThrowIfNull(code);
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(code)));
        var codeId = requestedCodeId ?? hash;

        if (useCache)
        {
            lock (_cacheLock)
            {
                if (_cache.TryGetValue(hash, out var cached))
                    return new CompileResult(true, codeId, true, [], cached);
            }
        }

        var contract = CheckContract(code);

        var tree = CSharpSyntaxTree.ParseText(code, new CSharpParseOptions(LanguageVersion.CSharp12));
        var compilation = CSharpCompilation.Create(
            $"Design_{hash[..12]}",
            [tree],
            _references,
            new CSharpCompilationOptions(
                OutputKind.DynamicallyLinkedLibrary,
                optimizationLevel: OptimizationLevel.Release,
                allowUnsafe: false,
                nullableContextOptions: NullableContextOptions.Enable));

        // docs/04 §8: analyzer first. Banned code is never emitted.
        var banned = BannedApiAnalyzer.Analyze(compilation.GetSemanticModel(tree));
        if (banned.Count > 0 || contract.Count > 0)
            return new CompileResult(false, codeId, false, [.. banned, .. contract]);

        using var ms = new MemoryStream();
        var emit = compilation.Emit(ms);
        var diagnostics = emit.Diagnostics
            .Where(d => d.Severity >= DiagnosticSeverity.Warning)
            .OrderByDescending(d => d.Severity)
            .Take(12)
            .Select(ToForge)
            .ToArray();
        if (!emit.Success) return new CompileResult(false, codeId, false, diagnostics);

        ReadOnlyMemory<byte> dll = ms.ToArray();
        if (useCache)
        {
            lock (_cacheLock)
            {
                if (_cacheOrder.Count >= MaxCacheEntries) _cache.Remove(_cacheOrder.Dequeue());
                if (_cache.TryAdd(hash, dll)) _cacheOrder.Enqueue(hash);
            }
        }
        return new CompileResult(true, codeId, false, diagnostics, dll);
    }

    private static ForgeDiagnostic ToForge(Diagnostic d)
    {
        var pos = d.Location.GetLineSpan().StartLinePosition;
        return new ForgeDiagnostic(d.Id, d.Severity.ToString(), pos.Line + 1, pos.Character + 1,
            d.GetMessage(System.Globalization.CultureInfo.InvariantCulture));
    }

    [GeneratedRegex(@"public\s+static\s+class\s+Design\b")]
    private static partial Regex DesignClassRx();

    [GeneratedRegex(@"public\s+static\s+Voxels\s+voxBuild\s*\(\s*Ctx\s+\w+\s*\)")]
    private static partial Regex VoxBuildRx();

    [GeneratedRegex(@"^\s*using\s+(static\s+)?([\w\.]+)\s*(=\s*[\w\.<>]+\s*)?;", RegexOptions.Multiline)]
    private static partial Regex UsingRx();

    internal static List<ForgeDiagnostic> CheckContract(string code)
    {
        var errors = new List<ForgeDiagnostic>();
        if (!DesignClassRx().IsMatch(code))
            errors.Add(new("CONTRACT001", "Error", 1, 1, "CONTRACT_VIOLATION: Missing 'public static class Design'"));
        if (!VoxBuildRx().IsMatch(code))
            errors.Add(new("CONTRACT002", "Error", 1, 1, "CONTRACT_VIOLATION: Missing 'public static Voxels voxBuild(Ctx ctx)' in Design"));

        foreach (Match m in UsingRx().Matches(code))
        {
            var ns = m.Groups[2].Value;
            if (m.Groups[1].Success || m.Groups[3].Success || !AllowedUsings.Contains(ns))
            {
                var line = code[..m.Index].Count(c => c == '\n') + 1 + (m.Value.TakeWhile(c => c is '\r' or '\n').Count());
                errors.Add(new("CONTRACT003", "Error", line, 1,
                    $"CONTRACT_VIOLATION: Disallowed using '{m.Value.Trim()}'. Allowed: {string.Join(", ", AllowedUsings)}"));
            }
        }

        var lineCount = code.Split('\n').Length;
        if (lineCount > 1200)
            errors.Add(new("CONTRACT004", "Error", 1201, 1, $"CONTRACT_VIOLATION: File exceeds 1200 lines ({lineCount} lines)"));
        return errors;
    }
}
