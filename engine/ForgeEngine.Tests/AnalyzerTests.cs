// ForgeEngine.Tests/AnalyzerTests.cs — ENG-ANALYZER-*: each banned API (docs/04 §8) is rejected with line and column.

using Xunit;

namespace ForgeEngine.Tests;

public class AnalyzerTests
{
    private static readonly DesignCompiler Compiler = new(Paths.SandboxDir);

    private const string Head = "using System.Numerics;\nusing PicoGK;\nusing PicoForge.Kit;\n\npublic static class Design\n{\n    public static Voxels voxBuild(Ctx ctx)\n    {\n";
    private const int BodyLine = 9;   // first line of the method body in Head
    private const string Tail = "\n        return Kit.voxSphere(ctx, Vector3.Zero, 5f);\n    }\n}\n";

    public static TheoryData<string, string, string> BannedBodies => new()
    {
        // test id suffix, body line, token where the diagnostic must point
        { "io", "        var t = System.IO.File.ReadAllText(\"secret.env\");", "File" },
        { "net", "        var c = new System.Net.Http.HttpClient();", "HttpClient" },
        { "emit", "        var b = System.Reflection.Emit.AssemblyBuilder.DefineDynamicAssembly(new System.Reflection.AssemblyName(\"x\"), System.Reflection.Emit.AssemblyBuilderAccess.Run);", "AssemblyBuilder" },
        { "reflection", "        var ts = typeof(Kit).Assembly.GetTypes();", "GetTypes" },
        { "diagnostics", "        System.Diagnostics.Process.Start(\"calc.exe\");", "Process" },
        { "threading", "        new System.Threading.Thread(() => { }).Start();", "Thread(" },
        { "tasks", "        System.Threading.Tasks.Task.Run(() => { });", "Task.Run" },
        { "environment", "        var e = Environment.GetEnvironmentVariable(\"ANTHROPIC_API_KEY\");", "Environment" },
        { "appdomain", "        var d = AppDomain.CurrentDomain;", "AppDomain" },
        { "unsafe", "        unsafe { int* p = null; }", "unsafe" },
        { "dynamic", "        dynamic d = ctx;", "dynamic" },
        { "marshal", "        var h = System.Runtime.InteropServices.Marshal.AllocHGlobal(16);", "Marshal" },
        { "picogk-library", "        PicoGK.Library.Go(0.5f, () => { });", "Library" },
        { "picogk-file", "        var vv = Voxels.voxFromVdbFile(\"C:/x.vdb\"); var u = PicoGK.Utils.strHomeFolder();", "voxFromVdbFile" },
        { "picogk-utils", "        var u = PicoGK.Utils.strHomeFolder();", "Utils" },
    };

    [Theory(DisplayName = "ENG-ANALYZER")]
    [MemberData(nameof(BannedBodies))]
    public void ENG_ANALYZER_banned_api_rejected_with_line_and_col(string id, string body, string token)
    {
        var r = Compiler.Compile(Head + body + Tail, $"analyzer-{id}", useCache: false);
        Assert.False(r.Ok, $"ENG-ANALYZER-{id}: banned code compiled");
        var col = body.IndexOf(token, StringComparison.Ordinal) + 1;
        var hit = r.Diagnostics.FirstOrDefault(d => d.Id == BannedApiAnalyzer.Id);
        Assert.True(hit is not null, $"ENG-ANALYZER-{id}: no FORGE001; got {string.Join("; ", r.Diagnostics.Select(d => $"{d.Id}@{d.Line}:{d.Col} {d.Message}"))}");
        Assert.True((BodyLine, col) == (hit!.Line, hit.Col),
            $"ENG-ANALYZER-{id}: expected {BodyLine}:{col}, got {string.Join("; ", r.Diagnostics.Select(d => $"{d.Id}@{d.Line}:{d.Col} {d.Message}"))}");
    }

    [Fact(DisplayName = "ENG-ANALYZER-dllimport")]
    public void ENG_ANALYZER_dllimport()
    {
        const string attrLine = "    [System.Runtime.InteropServices.DllImport(\"kernel32\")] public static extern bool Beep(int f, int d);";
        var code = Head + "        return Kit.voxSphere(ctx, Vector3.Zero, 5f);\n    }\n" + attrLine + "\n}\n";
        var r = Compiler.Compile(code, "analyzer-dllimport", useCache: false);
        Assert.False(r.Ok);
        var hit = r.Diagnostics.FirstOrDefault(d => d.Id == BannedApiAnalyzer.Id);
        Assert.NotNull(hit);
        Assert.Equal((11, attrLine.IndexOf("System.Runtime", StringComparison.Ordinal) + 1), (hit!.Line, hit.Col));
    }

    [Fact(DisplayName = "ENG-ANALYZER-using")]
    public void ENG_ANALYZER_using_directive()
    {
        var r = Compiler.Compile("using System.IO;\n" + Head + "        var t = File.ReadAllText(\"x\");" + Tail, "analyzer-using", useCache: false);
        Assert.False(r.Ok);
        Assert.Contains(r.Diagnostics, d => d.Id == BannedApiAnalyzer.Id && d.Line == 1 && d.Col == 1);
        Assert.Contains(r.Diagnostics, d => d.Id == BannedApiAnalyzer.Id && d.Line == BodyLine + 1 && d.Col == 17);
    }

    [Fact(DisplayName = "ENG-ANALYZER-interlocked-allowed")]
    public void ENG_ANALYZER_interlocked_is_allowed()
    {
        var r = Compiler.Compile(Head + "        int n = 0; System.Threading.Interlocked.Increment(ref n);" + Tail, "analyzer-interlocked", useCache: false);
        Assert.True(r.Ok, string.Join("; ", r.Diagnostics.Select(d => $"{d.Id}@{d.Line}:{d.Col} {d.Message}")));
    }

    [Fact(DisplayName = "ENG-ANALYZER-clean")]
    public void ENG_ANALYZER_clean_design_compiles()
    {
        var r = Compiler.Compile(Designs.Fan, "analyzer-fan", useCache: false);
        Assert.True(r.Ok, string.Join("; ", r.Diagnostics.Select(d => $"{d.Id}@{d.Line}:{d.Col} {d.Message}")));
        Assert.False(r.Dll.IsEmpty);
    }
}
