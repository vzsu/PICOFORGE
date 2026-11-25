// ForgeSandbox/Kit/Ctx.cs — The context object generated designs receive
// docs/05 §4 (Ctx.P / Ctx.Pi, Ctx.Log, Ctx.Progress), LLM_HARNESS §4.4

using System.Globalization;

namespace PicoForge.Kit;

/// <summary>
/// The only object generated code receives.
/// Carries voxel size, evaluated parameters (name → number), material, logger, progress.
/// </summary>
public sealed class Ctx
{
    public float fVoxelMM { get; }
    public Params oParams { get; }
    public Material oMat { get; }
    public Rng Rng { get; }
    public float fTimeLimitS { get; }

    private readonly Action<string> _log;
    private readonly Action<float> _progress;

    public Ctx(
        float voxelMm,
        IReadOnlyDictionary<string, double> parameters,
        Action<string> log,
        Action<float> progress,
        Material? material = null,
        float timeLimitS = 120f,
        string? runId = null)
    {
        fVoxelMM = voxelMm;
        oParams = new Params(parameters);
        oMat = material ?? Material.Petg;
        Rng = new Rng(runId ?? "default");
        fTimeLimitS = timeLimitS;
        _log = log;
        _progress = progress;
    }

    /// <summary>Evaluated float parameter; throws with the list of known names if missing (docs/05 §4).</summary>
    public float P(string name) => oParams.f(name);

    /// <summary>Evaluated integer parameter; throws with the list of known names if missing (docs/05 §4).</summary>
    public int Pi(string name) => oParams.n(name);

    public void Log(string s) => _log(s);
    public void Progress(float f01) => _progress(Math.Clamp(f01, 0f, 1f));
}

/// <summary>Typed accessors over brief parameters (name → number).</summary>
public sealed class Params
{
    private readonly IReadOnlyDictionary<string, double> _raw;

    public Params(IReadOnlyDictionary<string, double> raw) => _raw = raw;

    public IReadOnlyCollection<string> Names => _raw.Keys.Order(StringComparer.Ordinal).ToArray();

    public float f(string name) => (float)Get(name);

    public int n(string name)
    {
        var v = Get(name);
        var r = Math.Round(v);
        if (Math.Abs(v - r) > 1e-9 || r > int.MaxValue || r < int.MinValue)
            throw new ArgumentException(
                $"Parameter '{name}' = {v.ToString(CultureInfo.InvariantCulture)} is not an integer; use P(\"{name}\") for a float.",
                nameof(name));
        return (int)r;
    }

    public bool Has(string name) => _raw.ContainsKey(name);

    private double Get(string name)
    {
        if (_raw.TryGetValue(name, out var v)) return v;
        var known = _raw.Count == 0 ? "(none)" : string.Join(", ", Names);
        throw new KeyNotFoundException($"Parameter '{name}' not found. Known parameters: {known}");
    }
}

/// <summary>Material presets — DATA_SCHEMA materials table.</summary>
public sealed record Material(
    string Name,
    float DensityGcm3,
    float YieldMPa,
    float EGPa,
    float MinWallMM,
    float MaxTempC)
{
    public static readonly Material Pla = new("PLA", 1.24f, 45f, 3.5f, 1.0f, 55f);
    public static readonly Material Petg = new("PETG", 1.27f, 50f, 2.1f, 1.0f, 75f);
    public static readonly Material Abs = new("ABS", 1.05f, 40f, 2.0f, 1.2f, 95f);
    public static readonly Material Pa12 = new("PA12", 1.01f, 48f, 1.7f, 0.8f, 120f);
    public static readonly Material Resin = new("Resin", 1.15f, 55f, 2.6f, 0.6f, 60f);
    public static readonly Material Al6061 = new("Al6061-T6", 2.70f, 276f, 68.9f, 0.8f, 200f);
    public static readonly Material Ss316L = new("SS316L", 8.00f, 205f, 193f, 0.5f, 400f);

    public static Material FromName(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        return name.ToUpperInvariant() switch
        {
            "PLA" => Pla,
            "PETG" => Petg,
            "ABS" => Abs,
            "PA12" => Pa12,
            "RESIN" => Resin,
            "AL6061-T6" => Al6061,
            "SS316L" => Ss316L,
            _ => throw new ArgumentException($"Unknown material '{name}'. Valid: PLA, PETG, ABS, PA12, Resin, Al6061-T6, SS316L", nameof(name)),
        };
    }
}

/// <summary>Seeded deterministic RNG — no DateTime.Now, no new Random() in generated code.</summary>
public sealed class Rng
{
    private readonly Random _rng;

    public Rng(string seed)
    {
        ArgumentNullException.ThrowIfNull(seed);
        // string.GetHashCode() is randomized per process in .NET; use FNV-1a so the seed is stable across runs.
        uint h = 2166136261;
        foreach (var ch in seed) { h ^= ch; h *= 16777619; }
        _rng = new Random(unchecked((int)h));
    }

    // Determinism, not unpredictability, is the requirement here (same seed → same geometry).
    [System.Diagnostics.CodeAnalysis.SuppressMessage("Security", "CA5394:Do not use insecure randomness",
        Justification = "Seeded geometric RNG; reproducibility is required, no security use.")]
    public float NextFloat() => (float)_rng.NextDouble();

    public float NextFloat(float min, float max) => min + (max - min) * NextFloat();

    [System.Diagnostics.CodeAnalysis.SuppressMessage("Security", "CA5394:Do not use insecure randomness",
        Justification = "Seeded geometric RNG; reproducibility is required, no security use.")]
    public int NextInt(int min, int max) => _rng.Next(min, max);
}
