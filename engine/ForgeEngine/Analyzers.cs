// ForgeEngine/Analyzers.cs — Banned-API semantic analyzer for generated designs (FORGE001)
// docs/04 §8: bans System.IO, System.Net, System.Reflection.Emit, System.Diagnostics, threading except
// Interlocked, unsafe, DllImport, Environment, AppDomain. The analyzer is a filter, not the sandbox.
// Every finding carries 1-based line and column (ENG-ANALYZER-*).

using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace ForgeEngine;

internal static class BannedApiAnalyzer
{
    public const string Id = "FORGE001";

    /// <summary>Namespace prefixes (matched on whole segments) that generated code may not touch.</summary>
    internal static readonly string[] BannedNamespaces =
    [
        "System.IO",
        "System.Net",
        "System.Reflection",               // docs/04 §8 names Reflection.Emit; docs/05 §5 says "no reflection" → whole namespace
        "System.Diagnostics",
        "System.Threading",                // except System.Threading.Interlocked (below)
        "System.Runtime.InteropServices",  // DllImport / Marshal / NativeLibrary
        "System.Runtime.Loader",           // AssemblyLoadContext
        "Microsoft.Win32",
    ];

    /// <summary>Individual types banned outside the namespaces above.</summary>
    internal static readonly string[] BannedTypes =
    [
        "System.Environment",
        "System.AppDomain",
        "System.Activator",
        "System.GC",
        "System.Console",                  // designs log through ctx.Log
    ];

    /// <summary>PicoGK lifecycle, viewer and file I/O: reachable from design code but outside its contract.</summary>
    internal static readonly string[] BannedPicoGKTypes =
    [
        "PicoGK.Library", "PicoGK.Viewer", "PicoGK.OpenVdbFile", "PicoGK.CliIo", "PicoGK.TgaIo",
        "PicoGK.CsvTable", "PicoGK.LogFile", "PicoGK.Utils", "PicoGK.Vdb2Cli",
    ];

    private static readonly HashSet<string> AllowedTypes = new(StringComparer.Ordinal)
    {
        "System.Threading.Interlocked",
    };

    public static IReadOnlyList<ForgeDiagnostic> Analyze(SemanticModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        var root = model.SyntaxTree.GetRoot();
        var diags = new List<ForgeDiagnostic>();
        var covered = new HashSet<SyntaxNode>();

        void Report(SyntaxNode node, string what)
        {
            var pos = node.GetLocation().GetLineSpan().StartLinePosition;
            diags.Add(new ForgeDiagnostic(Id, "Error", pos.Line + 1, pos.Character + 1,
                $"Banned API: {what}. Generated designs may only use PicoGK geometry, PicoForge.Kit and System math/collections; log with ctx.Log."));
        }

        foreach (var node in root.DescendantNodesAndSelf())
        {
            switch (node)
            {
                case UnsafeStatementSyntax u:
                    Report(u, "'unsafe' block");
                    continue;
                case MemberDeclarationSyntax m when m.Modifiers.Any(SyntaxKind.UnsafeKeyword):
                    Report(m.Modifiers.First(t => t.IsKind(SyntaxKind.UnsafeKeyword)).Parent!, "'unsafe' modifier");
                    continue;
                case LocalFunctionStatementSyntax lf when lf.Modifiers.Any(SyntaxKind.UnsafeKeyword):
                    Report(lf, "'unsafe' local function");
                    continue;
                case FunctionPointerTypeSyntax fp:
                    Report(fp, "function pointer");
                    continue;
                case UsingDirectiveSyntax ud when ud.Name is not null:
                {
                    var ns = ud.Name.ToString();
                    if (IsBannedName(ns)) { Report(ud, $"using {ns}"); MarkCovered(ud.Name, covered); }
                    continue;
                }
                case AttributeSyntax attr:
                {
                    var t = model.GetSymbolInfo(attr).Symbol?.ContainingType ?? model.GetTypeInfo(attr).Type;
                    var name = attr.Name.ToString();
                    if (name is "DllImport" or "DllImportAttribute" or "LibraryImport" or "LibraryImportAttribute"
                        || (t is not null && BannedSymbolName(t) is not null))
                    {
                        Report(attr, $"attribute [{name}] (native interop)");
                        MarkCovered(attr.Name, covered);
                    }
                    continue;
                }
                case SimpleNameSyntax sn:
                {
                    if (covered.Contains(sn)) continue;
                    // `var` names the inferred type; the initializer that produced it is reported instead.
                    if (sn is IdentifierNameSyntax { IsVar: true }) continue;
                    // Left side of a qualified name / member access already reported → don't report its tail again.
                    if (sn.Parent is MemberAccessExpressionSyntax ma && ma.Name == sn && covered.Contains(ma.Expression)
                        || sn.Parent is QualifiedNameSyntax qn && qn.Right == sn && covered.Contains(qn.Left))
                    {
                        MarkCovered(sn, covered);
                        continue;
                    }
                    var info = model.GetSymbolInfo(sn);
                    var sym = info.Symbol ?? info.CandidateSymbols.FirstOrDefault();
                    if (sym is IDynamicTypeSymbol || sn.Identifier.ValueText == "dynamic" && model.GetTypeInfo(sn).Type is IDynamicTypeSymbol)
                    {
                        Report(sn, "'dynamic' (late binding bypasses analysis)");
                        MarkCovered(sn, covered);
                        continue;
                    }
                    // Namespace segments inside expressions are judged by the type they lead to
                    // (System.Threading.Interlocked is allowed, System.Threading.Thread is not).
                    if (sym is INamespaceSymbol) continue;
                    var banned = sym is null ? UnresolvedBannedName(sn) : BannedSymbolName(sym);
                    if (banned is not null)
                    {
                        Report(sn, banned);
                        MarkCovered(sn, covered);
                    }
                    continue;
                }
            }
        }
        return diags;
    }

    /// <summary>Marks a name and every enclosing qualified/member-access node it is the head of.</summary>
    private static void MarkCovered(SyntaxNode n, HashSet<SyntaxNode> covered)
    {
        covered.Add(n);
        var cur = n;
        while (cur.Parent is MemberAccessExpressionSyntax or QualifiedNameSyntax or AliasQualifiedNameSyntax)
        {
            cur = cur.Parent;
            covered.Add(cur);
        }
    }

    private static string? BannedSymbolName(ISymbol sym)
    {
        switch (sym)
        {
            case INamespaceSymbol ns:
                return IsBannedNamespace(ns.ToDisplayString()) ? $"namespace {ns.ToDisplayString()}" : null;
            case IAliasSymbol alias:
                return BannedSymbolName(alias.Target);
            case INamedTypeSymbol t:
                return BannedType(t);
            case IMethodSymbol { MethodKind: MethodKind.Constructor } ctor:
                return BannedType(ctor.ContainingType);
            default:
                if (sym.ContainingType is { } ct && BannedType(ct) is { } b) return $"{b}.{sym.Name}";
                // PicoGK file I/O members on otherwise allowed types (Voxels.SaveToVdbFile, Mesh.mshFromStlFile, …).
                if (sym.ContainingNamespace?.ToDisplayString() == "PicoGK" && sym.Name.Contains("File", StringComparison.Ordinal))
                    return $"PicoGK file I/O {sym.ContainingType?.Name}.{sym.Name}";
                return null;
        }
    }

    private static string? BannedType(INamedTypeSymbol t)
    {
        var def = t.OriginalDefinition;
        // Nested types inherit the verdict of their outermost containing type.
        while (def.ContainingType is not null) def = def.ContainingType.OriginalDefinition;
        var full = def.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat).Replace("global::", "", StringComparison.Ordinal);
        if (AllowedTypes.Contains(full)) return null;
        if (BannedTypes.Contains(full, StringComparer.Ordinal) || BannedPicoGKTypes.Contains(full, StringComparer.Ordinal))
            return $"type {full}";
        var ns = def.ContainingNamespace?.ToDisplayString() ?? "";
        return IsBannedNamespace(ns) ? $"type {full}" : null;
    }

    /// <summary>
    /// Unresolved identifier (e.g. `Environment` without `using System;`): still reported when its simple name is a
    /// banned type, so the diagnostic names the real problem instead of only CS0103.
    /// </summary>
    private static string? UnresolvedBannedName(SimpleNameSyntax sn)
    {
        var name = sn.Identifier.ValueText;
        var match = BannedTypes.Concat(BannedPicoGKTypes)
            .FirstOrDefault(t => t.EndsWith("." + name, StringComparison.Ordinal));
        return match is null ? null : $"type {match}";
    }

    private static bool IsBannedName(string dotted)
        => IsBannedNamespace(dotted) || BannedTypes.Contains(dotted, StringComparer.Ordinal)
           || BannedPicoGKTypes.Contains(dotted, StringComparer.Ordinal);

    internal static bool IsBannedNamespace(string ns)
        => BannedNamespaces.Any(b => ns == b || ns.StartsWith(b + ".", StringComparison.Ordinal));
}
